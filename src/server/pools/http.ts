/*
 * @Description: HTTP协议连接池管理器实现
 * @Usage: HTTP服务器的具体连接池管理实现
 * @Author: richen
 * @Date: 2024-11-27 20:35:00
 * @LastEditTime: 2024-11-27 20:35:00
 */

import { Socket } from "net";
import { 
  ConnectionPoolManager, 
  ConnectionPoolConfig, 
  ConnectionPoolEvent 
} from "./pool";
import { generateTraceId } from "../../utils/logger";

/**
 * HTTP连接元数据
 */
interface HttpConnectionMetadata {
  remoteAddress?: string;
  userAgent?: string;
  connectTime: number;
  lastActivity: number;
  requestCount: number;
}

/**
 * HTTP协议连接池管理器
 */
export class HttpConnectionPoolManager extends ConnectionPoolManager<Socket> {
  private connections = new Map<Socket, HttpConnectionMetadata>();
  private connectionTimeouts = new WeakMap<Socket, NodeJS.Timeout>();

  constructor(config: ConnectionPoolConfig = {}) {
    super('http', config);

    this.logger.info('HTTP connection pool manager initialized', {}, {
      maxConnections: config.maxConnections,
      connectionTimeout: config.connectionTimeout,
      keepAliveTimeout: config.keepAliveTimeout
    });
  }

  /**
   * 添加HTTP连接到池中
   */
  async addConnection(socket: Socket, metadata: any = {}): Promise<boolean> {
    const traceId = generateTraceId();
    
    // 检查连接数限制
    if (!this.canAcceptConnection()) {
      this.logger.warn('Connection rejected due to pool limit', { traceId }, {
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
    if (!this.validateConnection(socket)) {
      this.logger.warn('Invalid connection rejected', { traceId });
      return false;
    }

    const connectionMetadata: HttpConnectionMetadata = {
      remoteAddress: socket.remoteAddress,
      userAgent: metadata.userAgent || 'unknown',
      connectTime: Date.now(),
      lastActivity: Date.now(),
      requestCount: 0
    };

    this.connections.set(socket, connectionMetadata);
    this.recordConnectionEvent('added', connectionMetadata);

    // 设置连接超时
    this.setupConnectionTimeout(socket);

    // 监听连接事件
    this.setupConnectionListeners(socket, traceId);

    this.logger.debug('HTTP connection added to pool', { traceId }, {
      remoteAddress: connectionMetadata.remoteAddress,
      activeConnections: this.connections.size,
      totalConnections: this.metrics.totalConnections
    });

    this.emitEvent(ConnectionPoolEvent.CONNECTION_ADDED, {
      socket,
      metadata: connectionMetadata,
      poolStats: this.getMetrics()
    });

    return true;
  }

  /**
   * 从池中移除HTTP连接
   */
  async removeConnection(socket: Socket, reason: string = 'normal_close'): Promise<void> {
    const metadata = this.connections.get(socket);
    if (!metadata) return;

    const traceId = generateTraceId();
    const duration = Date.now() - metadata.connectTime;

    // 清理超时器
    const timeout = this.connectionTimeouts.get(socket);
    if (timeout) {
      clearTimeout(timeout);
      this.connectionTimeouts.delete(socket);
    }

    // 移除连接
    this.connections.delete(socket);
    this.recordConnectionEvent('removed', { reason, duration });

    this.logger.debug('HTTP connection removed from pool', { traceId }, {
      remoteAddress: metadata.remoteAddress,
      reason,
      duration: `${duration}ms`,
      requestCount: metadata.requestCount,
      activeConnections: this.connections.size
    });

    this.emitEvent(ConnectionPoolEvent.CONNECTION_REMOVED, {
      socket,
      metadata,
      reason,
      duration,
      poolStats: this.getMetrics()
    });

    // 清理连接资源
    await this.cleanupConnection(socket);
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
  isConnectionHealthy(socket: Socket): boolean {
    if (socket.destroyed || socket.readyState !== 'open') {
      return false;
    }

    const metadata = this.connections.get(socket);
    if (!metadata) return false;

    // 检查连接是否超时
    const now = Date.now();
    const connectionTimeout = this.config.connectionTimeout || 30000;
    
    if (now - metadata.lastActivity > connectionTimeout) {
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
      this.logger.info('No HTTP connections to close', { traceId });
      return;
    }

    this.logger.info('Closing all HTTP connections', { traceId }, {
      totalConnections: this.connections.size,
      timeout
    });

    const closePromises: Promise<void>[] = [];
    
    for (const [socket, _metadata] of this.connections.entries()) {
      const closePromise = new Promise<void>((resolve) => {
        const cleanup = () => {
          this.removeConnection(socket, 'pool_shutdown');
          resolve();
        };

        // 设置超时保护
        const timeoutId = setTimeout(cleanup, 1000);
        
        socket.once('close', () => {
          clearTimeout(timeoutId);
          cleanup();
        });

        // 优雅关闭连接
        if (!socket.destroyed) {
          socket.end();
        }
      });

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
      this.logger.warn('Force closing remaining HTTP connections', { traceId }, {
        remainingConnections: this.connections.size
      });

      for (const [socket] of this.connections.entries()) {
        if (!socket.destroyed) {
          socket.destroy();
        }
        await this.removeConnection(socket, 'force_close');
      }
    }

    this.logger.info('All HTTP connections closed', { traceId });
  }

  /**
   * 更新连接活动时间
   */
  updateConnectionActivity(socket: Socket): void {
    const metadata = this.connections.get(socket);
    if (metadata) {
      metadata.lastActivity = Date.now();
      metadata.requestCount++;
    }
  }

  /**
   * 获取连接信息
   */
  getConnectionInfo(socket: Socket): HttpConnectionMetadata | undefined {
    return this.connections.get(socket);
  }

  /**
   * 清理过期连接
   */
  cleanupStaleConnections(): number {
    const traceId = generateTraceId();
    const staleConnections: Socket[] = [];
    
    for (const [socket, _metadata] of this.connections.entries()) {
      if (!this.isConnectionHealthy(socket)) {
        staleConnections.push(socket);
      }
    }

    if (staleConnections.length > 0) {
      this.logger.info('Cleaning up stale HTTP connections', { traceId }, {
        staleCount: staleConnections.length,
        totalConnections: this.connections.size
      });

      staleConnections.forEach(socket => {
        this.removeConnection(socket, 'stale_connection');
        if (!socket.destroyed) {
          socket.destroy();
        }
      });
    }

    return staleConnections.length;
  }

  // ============= 协议特定的保护方法实现 =============

  /**
   * 验证HTTP连接
   */
  protected validateConnection(socket: Socket): boolean {
    if (!socket || socket.destroyed) {
      return false;
    }

    if (socket.readyState !== 'open') {
      return false;
    }

    return true;
  }

  /**
   * 清理HTTP连接资源
   */
  protected async cleanupConnection(socket: Socket): Promise<void> {
    try {
      // 移除所有监听器
      socket.removeAllListeners();
      
      // 确保连接已关闭
      if (!socket.destroyed) {
        socket.destroy();
      }
    } catch (error) {
      this.logger.debug('Error during HTTP connection cleanup', {}, error);
    }
  }

  // ============= 私有辅助方法 =============

  /**
   * 设置连接超时
   */
  private setupConnectionTimeout(socket: Socket): void {
    const connectionTimeout = this.config.connectionTimeout;
    if (!connectionTimeout) return;

    const timeoutId = setTimeout(() => {
      this.logger.debug('HTTP connection timeout', {}, {
        remoteAddress: socket.remoteAddress,
        timeout: connectionTimeout
      });

      this.emitEvent(ConnectionPoolEvent.CONNECTION_TIMEOUT, {
        socket,
        timeout: connectionTimeout
      });

      this.removeConnection(socket, 'timeout');
      if (!socket.destroyed) {
        socket.destroy();
      }
    }, connectionTimeout);

    this.connectionTimeouts.set(socket, timeoutId);
  }

  /**
   * 设置连接事件监听器
   */
  private setupConnectionListeners(socket: Socket, traceId: string): void {
    socket.on('close', () => {
      this.removeConnection(socket, 'client_close');
    });

    socket.on('error', (error) => {
      this.logger.debug('HTTP connection error', { traceId }, {
        remoteAddress: socket.remoteAddress,
        error: error.message
      });

      this.recordConnectionEvent('error', { error: error.message });
      this.emitEvent(ConnectionPoolEvent.CONNECTION_ERROR, {
        socket,
        error,
        poolStats: this.getMetrics()
      });

      this.removeConnection(socket, 'error');
    });

    socket.on('timeout', () => {
      this.logger.debug('HTTP socket timeout', { traceId }, {
        remoteAddress: socket.remoteAddress
      });

      this.removeConnection(socket, 'socket_timeout');
    });
  }
} 