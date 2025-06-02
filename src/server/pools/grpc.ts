/*
 * @Description: gRPC协议连接池管理器实现
 * @Usage: gRPC服务器的具体连接池管理实现
 * @Author: richen
 * @Date: 2024-11-27 20:45:00
 * @LastEditTime: 2024-11-27 20:45:00
 */

import { 
  ConnectionPoolManager, 
  ConnectionPoolConfig, 
  ConnectionPoolEvent 
} from "./pool";
import { generateTraceId } from "../../utils/logger";

/**
 * gRPC连接元数据
 */
interface GrpcConnectionMetadata {
  connectionId: string;
  peer?: string;
  connectTime: number;
  lastActivity: number;
  requestCount: number;
  serviceName?: string;
  methodName?: string;
}

/**
 * gRPC协议连接池管理器
 */
export class GrpcConnectionPoolManager extends ConnectionPoolManager<string> {
  private connections = new Map<string, GrpcConnectionMetadata>();
  private connectionTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(config: ConnectionPoolConfig = {}) {
    super('grpc', config);

    this.logger.info('gRPC connection pool manager initialized', {}, {
      maxConnections: config.maxConnections,
      connectionTimeout: config.connectionTimeout,
      keepAliveTime: config.protocolSpecific?.keepAliveTime
    });
  }

  /**
   * 添加gRPC连接到池中
   */
  async addConnection(connectionId: string, metadata: any = {}): Promise<boolean> {
    const traceId = generateTraceId();
    
    // 检查连接数限制
    if (!this.canAcceptConnection()) {
      this.logger.warn('gRPC connection rejected due to pool limit', { traceId }, {
        activeConnections: this.connections.size,
        maxConnections: this.config.maxConnections
      });
      
      this.currentHealth.rejectedConnections++;
      this.emitEvent(ConnectionPoolEvent.POOL_LIMIT_REACHED, {
        activeConnections: this.connections.size,
        maxConnections: this.config.maxConnections
      });
      
      return false;
    }

    // 验证连接
    if (!this.validateConnection(connectionId)) {
      this.logger.warn('Invalid gRPC connection rejected', { traceId });
      return false;
    }

    const connectionMetadata: GrpcConnectionMetadata = {
      connectionId,
      peer: metadata.peer || 'unknown',
      connectTime: Date.now(),
      lastActivity: Date.now(),
      requestCount: 0,
      serviceName: metadata.serviceName,
      methodName: metadata.methodName
    };

    this.connections.set(connectionId, connectionMetadata);
    this.recordConnectionEvent('added', connectionMetadata);

    // 设置连接超时（gRPC Keep-alive机制）
    this.setupConnectionTimeout(connectionId);

    this.logger.debug('gRPC connection added to pool', { traceId }, {
      connectionId,
      peer: connectionMetadata.peer,
      serviceName: connectionMetadata.serviceName,
      activeConnections: this.connections.size,
      totalConnections: this.metrics.totalConnections
    });

    this.emitEvent(ConnectionPoolEvent.CONNECTION_ADDED, {
      connectionId,
      metadata: connectionMetadata,
      poolStats: this.getMetrics()
    });

    return true;
  }

  /**
   * 从池中移除gRPC连接
   */
  async removeConnection(connectionId: string, reason: string = 'normal_close'): Promise<void> {
    const metadata = this.connections.get(connectionId);
    if (!metadata) return;

    const traceId = generateTraceId();
    const duration = Date.now() - metadata.connectTime;

    // 清理超时器
    const timeout = this.connectionTimeouts.get(connectionId);
    if (timeout) {
      clearTimeout(timeout);
      this.connectionTimeouts.delete(connectionId);
    }

    // 移除连接
    this.connections.delete(connectionId);
    this.recordConnectionEvent('removed', { reason, duration });

    this.logger.debug('gRPC connection removed from pool', { traceId }, {
      connectionId,
      peer: metadata.peer,
      serviceName: metadata.serviceName,
      reason,
      duration: `${duration}ms`,
      requestCount: metadata.requestCount,
      activeConnections: this.connections.size
    });

    this.emitEvent(ConnectionPoolEvent.CONNECTION_REMOVED, {
      connectionId,
      metadata,
      reason,
      duration,
      poolStats: this.getMetrics()
    });

    // 清理连接资源
    await this.cleanupConnection(connectionId);
  }

  /**
   * 获取活跃连接数
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * 检查连接是否健康
   */
  isConnectionHealthy(connectionId: string): boolean {
    const metadata = this.connections.get(connectionId);
    if (!metadata) return false;

    // 检查连接是否超时
    const now = Date.now();
    const keepAliveTime = this.config.protocolSpecific?.keepAliveTime || 30000;
    
    if (now - metadata.lastActivity > keepAliveTime) {
      return false;
    }

    return true;
  }

  /**
   * 关闭所有连接
   */
  async closeAllConnections(timeout: number = 5000): Promise<void> {
    const traceId = generateTraceId();
    
    if (this.connections.size === 0) {
      this.logger.info('No gRPC connections to close', { traceId });
      return;
    }

    this.logger.info('Closing all gRPC connections', { traceId }, {
      totalConnections: this.connections.size,
      timeout
    });

    const closePromises: Promise<void>[] = [];
    
    for (const [connectionId, _metadata] of this.connections.entries()) {
      const closePromise = this.removeConnection(connectionId, 'pool_shutdown');
      closePromises.push(closePromise);
    }

    // 等待所有连接关闭或超时
    const racePromise = Promise.race([
      Promise.all(closePromises),
      new Promise<void>((resolve) => setTimeout(resolve, timeout))
    ]);

    await racePromise;

    // 强制关闭剩余连接
    if (this.connections.size > 0) {
      this.logger.warn('Force closing remaining gRPC connections', { traceId }, {
        remainingConnections: this.connections.size
      });

      for (const [connectionId] of this.connections.entries()) {
        await this.removeConnection(connectionId, 'force_close');
      }
    }

    this.logger.info('All gRPC connections closed', { traceId });
  }

  /**
   * 更新连接活动时间
   */
  updateConnectionActivity(connectionId: string, methodName?: string): void {
    const metadata = this.connections.get(connectionId);
    if (metadata) {
      metadata.lastActivity = Date.now();
      metadata.requestCount++;
      if (methodName) {
        metadata.methodName = methodName;
      }
    }
  }

  /**
   * 获取连接信息
   */
  getConnectionInfo(connectionId: string): GrpcConnectionMetadata | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * 清理过期连接
   */
  cleanupStaleConnections(): number {
    const traceId = generateTraceId();
    const staleConnections: string[] = [];
    
    for (const [connectionId, _metadata] of this.connections.entries()) {
      if (!this.isConnectionHealthy(connectionId)) {
        staleConnections.push(connectionId);
      }
    }

    if (staleConnections.length > 0) {
      this.logger.info('Cleaning up stale gRPC connections', { traceId }, {
        staleCount: staleConnections.length,
        totalConnections: this.connections.size
      });

      staleConnections.forEach(connectionId => {
        this.removeConnection(connectionId, 'stale_connection');
      });
    }

    return staleConnections.length;
  }

  // ============= 协议特定的保护方法实现 =============

  /**
   * 验证gRPC连接
   */
  protected validateConnection(connectionId: string): boolean {
    if (!connectionId || typeof connectionId !== 'string') {
      return false;
    }

    // 检查连接ID是否已存在
    if (this.connections.has(connectionId)) {
      return false;
    }

    return true;
  }

  /**
   * 清理gRPC连接资源
   */
  protected async cleanupConnection(connectionId: string): Promise<void> {
    try {
      // gRPC连接清理逻辑
      // 这里可以添加特定的gRPC连接清理代码
      this.logger.debug('gRPC connection cleaned up', {}, { connectionId });
    } catch (error) {
      this.logger.debug('Error during gRPC connection cleanup', {}, { connectionId, error });
    }
  }

  // ============= 私有辅助方法 =============

  /**
   * 设置连接超时（Keep-alive机制）
   */
  private setupConnectionTimeout(connectionId: string): void {
    const keepAliveTime = this.config.protocolSpecific?.keepAliveTime || 30000;

    const timeoutId = setTimeout(() => {
      this.logger.debug('gRPC connection keep-alive timeout', {}, {
        connectionId,
        keepAliveTime
      });

      this.emitEvent(ConnectionPoolEvent.CONNECTION_TIMEOUT, {
        connectionId,
        timeout: keepAliveTime
      });

      this.removeConnection(connectionId, 'keep_alive_timeout');
    }, keepAliveTime);

    this.connectionTimeouts.set(connectionId, timeoutId);
  }

  /**
   * 记录gRPC方法调用
   */
  recordMethodCall(connectionId: string, serviceName: string, methodName: string, success: boolean = true): void {
    this.updateConnectionActivity(connectionId, methodName);
    
    const metadata = this.connections.get(connectionId);
    if (metadata) {
      metadata.serviceName = serviceName;
      metadata.methodName = methodName;
    }

    if (!success) {
      this.recordConnectionEvent('error', { serviceName, methodName });
      this.emitEvent(ConnectionPoolEvent.CONNECTION_ERROR, {
        connectionId,
        serviceName,
        methodName,
        poolStats: this.getMetrics()
      });
    }
  }
} 