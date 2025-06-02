/*
 * @Description: WebSocket协议连接池管理器实现
 * @Usage: WebSocket服务器的具体连接池管理实现
 * @Author: richen
 * @Date: 2024-11-27 20:50:00
 * @LastEditTime: 2024-11-27 20:50:00
 */

import { WebSocket } from 'ws';
import { 
  ConnectionPoolManager, 
  ConnectionPoolConfig, 
  ConnectionPoolEvent 
} from "./pool";
import { generateTraceId } from "../../utils/logger";

/**
 * WebSocket连接元数据
 */
interface WebSocketConnectionMetadata {
  connectionId: string;
  remoteAddress?: string;
  origin?: string;
  userAgent?: string;
  connectTime: number;
  lastActivity: number;
  messageCount: number;
  protocol?: string;
}

/**
 * WebSocket协议连接池管理器
 */
export class WebSocketConnectionPoolManager extends ConnectionPoolManager<WebSocket> {
  private connections = new Map<WebSocket, WebSocketConnectionMetadata>();
  private connectionIds = new WeakMap<WebSocket, string>();
  private pingInterval?: NodeJS.Timeout;

  constructor(config: ConnectionPoolConfig = {}) {
    super('websocket', config);

    this.logger.info('WebSocket connection pool manager initialized', {}, {
      maxConnections: config.maxConnections,
      connectionTimeout: config.connectionTimeout,
      pingInterval: config.protocolSpecific?.pingInterval
    });

    // 设置Ping心跳机制
    this.setupPingInterval();
  }

  /**
   * 添加WebSocket连接到池中
   */
  async addConnection(ws: WebSocket, metadata: any = {}): Promise<boolean> {
    const traceId = generateTraceId();
    
    // 检查连接数限制
    if (!this.canAcceptConnection()) {
      this.logger.warn('WebSocket connection rejected due to pool limit', { traceId }, {
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
    if (!this.validateConnection(ws)) {
      this.logger.warn('Invalid WebSocket connection rejected', { traceId });
      return false;
    }

    const connectionId = this.generateConnectionId();
    const connectionMetadata: WebSocketConnectionMetadata = {
      connectionId,
      remoteAddress: metadata.remoteAddress,
      origin: metadata.origin,
      userAgent: metadata.userAgent,
      connectTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      protocol: metadata.protocol
    };

    this.connections.set(ws, connectionMetadata);
    this.connectionIds.set(ws, connectionId);
    this.recordConnectionEvent('added', connectionMetadata);

    // 设置WebSocket事件监听器
    this.setupWebSocketListeners(ws, traceId);

    this.logger.debug('WebSocket connection added to pool', { traceId }, {
      connectionId,
      remoteAddress: connectionMetadata.remoteAddress,
      origin: connectionMetadata.origin,
      activeConnections: this.connections.size,
      totalConnections: this.metrics.totalConnections
    });

    this.emitEvent(ConnectionPoolEvent.CONNECTION_ADDED, {
      ws,
      metadata: connectionMetadata,
      poolStats: this.getMetrics()
    });

    return true;
  }

  /**
   * 从池中移除WebSocket连接
   */
  async removeConnection(ws: WebSocket, reason: string = 'normal_close'): Promise<void> {
    const metadata = this.connections.get(ws);
    if (!metadata) return;

    const traceId = generateTraceId();
    const duration = Date.now() - metadata.connectTime;

    // 移除连接
    this.connections.delete(ws);
    this.connectionIds.delete(ws);
    this.recordConnectionEvent('removed', { reason, duration });

    this.logger.debug('WebSocket connection removed from pool', { traceId }, {
      connectionId: metadata.connectionId,
      remoteAddress: metadata.remoteAddress,
      reason,
      duration: `${duration}ms`,
      messageCount: metadata.messageCount,
      activeConnections: this.connections.size
    });

    this.emitEvent(ConnectionPoolEvent.CONNECTION_REMOVED, {
      ws,
      metadata,
      reason,
      duration,
      poolStats: this.getMetrics()
    });

    // 清理连接资源
    await this.cleanupConnection(ws);
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
  isConnectionHealthy(ws: WebSocket): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const metadata = this.connections.get(ws);
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
      this.logger.info('No WebSocket connections to close', { traceId });
      return;
    }

    this.logger.info('Closing all WebSocket connections', { traceId }, {
      totalConnections: this.connections.size,
      timeout
    });

    const closePromises: Promise<void>[] = [];
    
    for (const [ws, _metadata] of this.connections.entries()) {
      const closePromise = new Promise<void>((resolve) => {
        const cleanup = () => {
          this.removeConnection(ws, 'pool_shutdown');
          resolve();
        };

        // 设置超时保护
        const timeoutId = setTimeout(cleanup, 1000);
        
        ws.once('close', () => {
          clearTimeout(timeoutId);
          cleanup();
        });

        // 优雅关闭连接
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Server shutting down');
        } else {
          cleanup();
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
      this.logger.warn('Force closing remaining WebSocket connections', { traceId }, {
        remainingConnections: this.connections.size
      });

      for (const [ws] of this.connections.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.terminate();
        }
        await this.removeConnection(ws, 'force_close');
      }
    }

    this.logger.info('All WebSocket connections closed', { traceId });
  }

  /**
   * 更新连接活动时间
   */
  updateConnectionActivity(ws: WebSocket): void {
    const metadata = this.connections.get(ws);
    if (metadata) {
      metadata.lastActivity = Date.now();
      metadata.messageCount++;
    }
  }

  /**
   * 获取连接信息
   */
  getConnectionInfo(ws: WebSocket): WebSocketConnectionMetadata | undefined {
    return this.connections.get(ws);
  }

  /**
   * 获取连接ID
   */
  getConnectionId(ws: WebSocket): string | undefined {
    return this.connectionIds.get(ws);
  }

  /**
   * 清理过期连接
   */
  cleanupStaleConnections(): number {
    const traceId = generateTraceId();
    const staleConnections: WebSocket[] = [];
    
    for (const [ws, _metadata] of this.connections.entries()) {
      if (!this.isConnectionHealthy(ws)) {
        staleConnections.push(ws);
      }
    }

    if (staleConnections.length > 0) {
      this.logger.info('Cleaning up stale WebSocket connections', { traceId }, {
        staleCount: staleConnections.length,
        totalConnections: this.connections.size
      });

      staleConnections.forEach(ws => {
        this.removeConnection(ws, 'stale_connection');
        if (ws.readyState === WebSocket.OPEN) {
          ws.terminate();
        }
      });
    }

    return staleConnections.length;
  }

  /**
   * 广播消息到所有连接
   */
  broadcast(message: string | Buffer, excludeWs?: WebSocket): number {
    let sentCount = 0;
    
    for (const [ws, metadata] of this.connections.entries()) {
      if (excludeWs && ws === excludeWs) continue;
      
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
          this.updateConnectionActivity(ws);
          sentCount++;
        } catch (error) {
          this.logger.debug('Failed to send broadcast message', {}, {
            connectionId: metadata.connectionId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          this.removeConnection(ws, 'send_error');
        }
      }
    }
    
    return sentCount;
  }

  // ============= 协议特定的保护方法实现 =============

  /**
   * 验证WebSocket连接
   */
  protected validateConnection(ws: WebSocket): boolean {
    if (!ws || typeof ws !== 'object') {
      return false;
    }

    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    return true;
  }

  /**
   * 清理WebSocket连接资源
   */
  protected async cleanupConnection(ws: WebSocket): Promise<void> {
    try {
      // 移除所有监听器
      ws.removeAllListeners();
      
      // 确保连接已关闭
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    } catch (error) {
      this.logger.debug('Error during WebSocket connection cleanup', {}, error);
    }
  }

  // ============= 私有辅助方法 =============

  /**
   * 生成连接ID
   */
  private generateConnectionId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 设置WebSocket事件监听器
   */
  private setupWebSocketListeners(ws: WebSocket, traceId: string): void {
    ws.on('message', () => {
      this.updateConnectionActivity(ws);
    });

    ws.on('close', (code: number, _reason: Buffer) => {
      this.removeConnection(ws, `client_close_${code}`);
    });

    ws.on('error', (error: Error) => {
      const metadata = this.connections.get(ws);
      this.logger.debug('WebSocket connection error', { traceId }, {
        connectionId: metadata?.connectionId,
        remoteAddress: metadata?.remoteAddress,
        error: error.message
      });

      this.recordConnectionEvent('error', { error: error.message });
      this.emitEvent(ConnectionPoolEvent.CONNECTION_ERROR, {
        ws,
        error,
        poolStats: this.getMetrics()
      });

      this.removeConnection(ws, 'error');
    });

    ws.on('pong', () => {
      this.updateConnectionActivity(ws);
    });
  }

  /**
   * 设置Ping心跳机制
   */
  private setupPingInterval(): void {
    const pingInterval = this.config.protocolSpecific?.pingInterval || 30000;
    
    this.pingInterval = setInterval(() => {
      const traceId = generateTraceId();
      let pingSent = 0;
      let pingFailed = 0;

      for (const [ws, metadata] of this.connections.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
            pingSent++;
          } catch (error) {
            this.logger.debug('Failed to send ping', { traceId }, {
              connectionId: metadata.connectionId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            pingFailed++;
            this.removeConnection(ws, 'ping_failed');
          }
        }
      }

      if (pingSent > 0 || pingFailed > 0) {
        this.logger.debug('WebSocket ping cycle completed', { traceId }, {
          pingSent,
          pingFailed,
          activeConnections: this.connections.size
        });
      }
    }, pingInterval);
  }

  /**
   * 销毁连接池
   */
  async destroy(): Promise<void> {
    // 停止ping间隔
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    // 调用父类销毁方法
    await super.destroy();
  }
} 