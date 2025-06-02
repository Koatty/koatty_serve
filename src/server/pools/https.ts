/*
 * @Description: HTTPS协议连接池管理器实现
 * @Usage: HTTPS服务器的具体连接池管理实现
 * @Author: richen
 * @Date: 2024-11-27 20:55:00
 * @LastEditTime: 2024-11-27 20:55:00
 */

import { TLSSocket } from "tls";
import { 
  ConnectionPoolManager, 
  ConnectionPoolConfig, 
  ConnectionPoolEvent 
} from "./pool";
import { generateTraceId } from "../../utils/logger";

/**
 * HTTPS连接元数据
 */
interface HttpsConnectionMetadata {
  remoteAddress?: string;
  userAgent?: string;
  connectTime: number;
  lastActivity: number;
  requestCount: number;
  tlsVersion?: string;
  cipherSuite?: string;
  serverName?: string;
  authorized: boolean;
}

/**
 * HTTPS协议连接池管理器
 */
export class HttpsConnectionPoolManager extends ConnectionPoolManager<TLSSocket> {
  private connections = new Map<TLSSocket, HttpsConnectionMetadata>();
  private connectionTimeouts = new WeakMap<TLSSocket, NodeJS.Timeout>();

  constructor(config: ConnectionPoolConfig = {}) {
    super('https', config);

    this.logger.info('HTTPS connection pool manager initialized', {}, {
      maxConnections: config.maxConnections,
      connectionTimeout: config.connectionTimeout,
      keepAliveTimeout: config.keepAliveTimeout
    });
  }

  /**
   * 添加HTTPS连接到池中
   */
  async addConnection(socket: TLSSocket, metadata: any = {}): Promise<boolean> {
    const traceId = generateTraceId();
    
    // 检查连接数限制
    if (!this.canAcceptConnection()) {
      this.logger.warn('HTTPS connection rejected due to pool limit', { traceId }, {
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
      this.logger.warn('Invalid HTTPS connection rejected', { traceId });
      return false;
    }

    const connectionMetadata: HttpsConnectionMetadata = {
      remoteAddress: socket.remoteAddress,
      userAgent: metadata.userAgent || 'unknown',
      connectTime: Date.now(),
      lastActivity: Date.now(),
      requestCount: 0,
      tlsVersion: socket.getProtocol(),
      cipherSuite: socket.getCipher()?.name,
      serverName: (socket as any).servername || metadata.serverName,
      authorized: socket.authorized
    };

    this.connections.set(socket, connectionMetadata);
    this.recordConnectionEvent('added', connectionMetadata);

    // 设置连接超时
    this.setupConnectionTimeout(socket);

    // 监听连接事件
    this.setupConnectionListeners(socket, traceId);

    this.logger.debug('HTTPS connection added to pool', { traceId }, {
      remoteAddress: connectionMetadata.remoteAddress,
      tlsVersion: connectionMetadata.tlsVersion,
      cipherSuite: connectionMetadata.cipherSuite,
      authorized: connectionMetadata.authorized,
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
   * 从池中移除HTTPS连接
   */
  async removeConnection(socket: TLSSocket, reason: string = 'normal_close'): Promise<void> {
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

    this.logger.debug('HTTPS connection removed from pool', { traceId }, {
      remoteAddress: metadata.remoteAddress,
      tlsVersion: metadata.tlsVersion,
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
  isConnectionHealthy(socket: TLSSocket): boolean {
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

    // 检查TLS连接是否仍然有效
    if (!socket.authorized && socket.authorizationError) {
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
      this.logger.info('No HTTPS connections to close', { traceId });
      return;
    }

    this.logger.info('Closing all HTTPS connections', { traceId }, {
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
      this.logger.warn('Force closing remaining HTTPS connections', { traceId }, {
        remainingConnections: this.connections.size
      });

      for (const [socket] of this.connections.entries()) {
        if (!socket.destroyed) {
          socket.destroy();
        }
        await this.removeConnection(socket, 'force_close');
      }
    }

    this.logger.info('All HTTPS connections closed', { traceId });
  }

  /**
   * 更新连接活动时间
   */
  updateConnectionActivity(socket: TLSSocket): void {
    const metadata = this.connections.get(socket);
    if (metadata) {
      metadata.lastActivity = Date.now();
      metadata.requestCount++;
    }
  }

  /**
   * 获取连接信息
   */
  getConnectionInfo(socket: TLSSocket): HttpsConnectionMetadata | undefined {
    return this.connections.get(socket);
  }

  /**
   * 清理过期连接
   */
  cleanupStaleConnections(): number {
    const traceId = generateTraceId();
    const staleConnections: TLSSocket[] = [];
    
    for (const [socket, _metadata] of this.connections.entries()) {
      if (!this.isConnectionHealthy(socket)) {
        staleConnections.push(socket);
      }
    }

    if (staleConnections.length > 0) {
      this.logger.info('Cleaning up stale HTTPS connections', { traceId }, {
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

  /**
   * 获取TLS安全指标
   */
  getSecurityMetrics(): Record<string, any> {
    const metrics = {
      totalConnections: this.connections.size,
      authorizedConnections: 0,
      unauthorizedConnections: 0,
      tlsVersions: new Map<string, number>(),
      cipherSuites: new Map<string, number>()
    };

    for (const [_socket, metadata] of this.connections.entries()) {
      if (metadata.authorized) {
        metrics.authorizedConnections++;
      } else {
        metrics.unauthorizedConnections++;
      }

      if (metadata.tlsVersion) {
        const count = metrics.tlsVersions.get(metadata.tlsVersion) || 0;
        metrics.tlsVersions.set(metadata.tlsVersion, count + 1);
      }

      if (metadata.cipherSuite) {
        const count = metrics.cipherSuites.get(metadata.cipherSuite) || 0;
        metrics.cipherSuites.set(metadata.cipherSuite, count + 1);
      }
    }

    return {
      ...metrics,
      tlsVersions: Object.fromEntries(metrics.tlsVersions),
      cipherSuites: Object.fromEntries(metrics.cipherSuites)
    };
  }

  // ============= 协议特定的保护方法实现 =============

  /**
   * 验证HTTPS连接
   */
  protected validateConnection(socket: TLSSocket): boolean {
    if (!socket || socket.destroyed) {
      return false;
    }

    if (socket.readyState !== 'open') {
      return false;
    }

    // 检查TLS握手是否完成
    if (!socket.getCipher()) {
      return false;
    }

    return true;
  }

  /**
   * 清理HTTPS连接资源
   */
  protected async cleanupConnection(socket: TLSSocket): Promise<void> {
    try {
      // 移除所有监听器
      socket.removeAllListeners();
      
      // 确保连接已关闭
      if (!socket.destroyed) {
        socket.destroy();
      }
    } catch (error) {
      this.logger.debug('Error during HTTPS connection cleanup', {}, error);
    }
  }

  // ============= 私有辅助方法 =============

  /**
   * 设置连接超时
   */
  private setupConnectionTimeout(socket: TLSSocket): void {
    const connectionTimeout = this.config.connectionTimeout;
    if (!connectionTimeout) return;

    const timeoutId = setTimeout(() => {
      this.logger.debug('HTTPS connection timeout', {}, {
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
  private setupConnectionListeners(socket: TLSSocket, traceId: string): void {
    socket.on('close', () => {
      this.removeConnection(socket, 'client_close');
    });

    socket.on('error', (error) => {
      this.logger.debug('HTTPS connection error', { traceId }, {
        remoteAddress: socket.remoteAddress,
        error: error.message,
        tlsVersion: socket.getProtocol()
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
      this.logger.debug('HTTPS socket timeout', { traceId }, {
        remoteAddress: socket.remoteAddress
      });

      this.removeConnection(socket, 'socket_timeout');
    });

    // TLS特定事件
    socket.on('secureConnect', () => {
      this.logger.debug('HTTPS secure connection established', { traceId }, {
        remoteAddress: socket.remoteAddress,
        tlsVersion: socket.getProtocol(),
        cipherSuite: socket.getCipher()?.name,
        authorized: socket.authorized
      });
    });
  }
} 