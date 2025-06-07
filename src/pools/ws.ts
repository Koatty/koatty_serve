/*
 * @Description: WebSocket连接池管理器
 * @Usage: WebSocket协议的连接池实现
 * @Author: richen
 * @Date: 2024-11-27 21:00:00
 * @LastEditTime: 2024-11-27 21:00:00
 */

import * as WS from 'ws';
import { IncomingMessage } from 'http';
import { 
  ConnectionPoolManager, 
  ConnectionRequestOptions
} from './pool';
import { ConnectionPoolConfig } from '../config/pool';

/**
 * WebSocket连接元数据
 */
interface WebSocketConnectionMetadata {
  id: string;
  createdAt: number;
  lastUsed: number;
  available: boolean;
  request?: IncomingMessage;
  remoteAddress?: string;
  userAgent?: string;
  lastPingTime?: number;
  lastPongTime?: number;
  isAlive: boolean;
}

/**
 * WebSocket连接池管理器
 */
export class WebSocketConnectionPoolManager extends ConnectionPoolManager<WS.WebSocket> {
  private heartbeatInterval?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;

  constructor(config: ConnectionPoolConfig = {}) {
    super('websocket', config);
    
    // 启动心跳监控
    this.startHeartbeat();
  }

  /**
   * 验证WebSocket连接
   */
  protected validateConnection(connection: WS.WebSocket): boolean {
    return connection instanceof WS.WebSocket && 
           connection.readyState === WS.WebSocket.OPEN;
  }

  /**
   * 清理WebSocket连接
   */
  protected async cleanupConnection(connection: WS.WebSocket): Promise<void> {
    try {
      if (connection.readyState === WS.WebSocket.OPEN || 
          connection.readyState === WS.WebSocket.CONNECTING) {
        connection.close(1000, 'Connection pool cleanup');
      }
    } catch (error) {
      this.logger.warn('Error cleaning up WebSocket connection', {}, error);
    }
  }

  /**
   * 获取可用连接
   */
  protected async getAvailableConnection(): Promise<{ connection: WS.WebSocket; id: string } | null> {
    for (const [id, metadata] of this.connectionMetadata) {
      if (metadata.available && this.isConnectionHealthy(this.connections.get(id)!)) {
        const connection = this.connections.get(id);
        if (connection) {
          // 标记为不可用
          metadata.available = false;
          metadata.lastUsed = Date.now();
          return { connection, id };
        }
      }
    }
    return null;
  }

  /**
   * 创建新连接 - WebSocket不需要主动创建连接
   * 连接是由客户端发起的，这里返回null
   */
  protected async createNewConnection(_options: ConnectionRequestOptions): Promise<{ connection: WS.WebSocket; id: string; metadata?: any } | null> {
    // WebSocket连接由客户端发起，服务端不主动创建连接
    // 实际的连接会通过addConnection方法添加
    return null;
  }

  /**
   * 检查连接是否健康
   */
  isConnectionHealthy(connection: WS.WebSocket): boolean {
    if (!connection) return false;
    
    const isOpen = connection.readyState === WS.WebSocket.OPEN;
    const connectionId = this.findWebSocketConnectionId(connection);
    
    if (!connectionId) return false;
    
    const metadata = this.connectionMetadata.get(connectionId) as WebSocketConnectionMetadata;
    if (!metadata) return false;
    
    // 检查是否活跃（最近的ping/pong）
    const now = Date.now();
    const pingTimeout = this.config.protocolSpecific?.pongTimeout || 30000;
    
    if (metadata.lastPingTime && !metadata.lastPongTime) {
      // 有ping但没有pong，检查超时
      if (now - metadata.lastPingTime > pingTimeout) {
        return false;
      }
    }
    
    return isOpen && metadata.isAlive;
  }

  /**
   * 协议特定的连接处理器设置
   */
  protected async setupProtocolSpecificHandlers(connection: WS.WebSocket): Promise<void> {
    const connectionId = this.findWebSocketConnectionId(connection);
    if (!connectionId) return;

    // 处理连接关闭
    connection.on('close', () => {
      this.removeConnection(connection, 'Client disconnected').catch(error => {
        this.logger.error('Error removing closed connection', {}, error);
      });
    });

    // 处理连接错误
    connection.on('error', (error) => {
      this.logger.warn('WebSocket connection error', {}, { 
        connectionId, 
        error: error.message 
      });
      this.removeConnection(connection, `Connection error: ${error.message}`).catch(err => {
        this.logger.error('Error removing errored connection', {}, err);
      });
    });

    // 处理pong响应
    connection.on('pong', () => {
      const metadata = this.connectionMetadata.get(connectionId) as WebSocketConnectionMetadata;
      if (metadata) {
        metadata.isAlive = true;
        metadata.lastPongTime = Date.now();
      }
    });

    // 处理消息
    connection.on('message', () => {
      const metadata = this.connectionMetadata.get(connectionId) as WebSocketConnectionMetadata;
      if (metadata) {
        metadata.lastUsed = Date.now();
        metadata.isAlive = true;
      }
    });
  }

  /**
   * 协议特定的连接创建逻辑
   */
  protected async createProtocolConnection(_options: ConnectionRequestOptions): Promise<{ connection: WS.WebSocket; metadata?: any } | null> {
    // WebSocket连接由客户端发起，服务端不主动创建连接
    // 连接通过registerConnection方法注册到池中
    return null;
  }

  /**
   * 添加WebSocket连接（对外接口，使用统一的registerConnection）
   */
  async addWebSocketConnection(
    connection: WS.WebSocket, 
    request?: IncomingMessage
  ): Promise<boolean> {
    const metadata: Partial<WebSocketConnectionMetadata> = {
      request,
      remoteAddress: request?.socket?.remoteAddress,
      userAgent: request?.headers['user-agent'],
      isAlive: true,
      lastPingTime: undefined,
      lastPongTime: undefined
    };

    return this.registerConnection(connection, metadata);
  }

  /**
   * 启动心跳监控
   */
  private startHeartbeat(): void {
    const pingInterval = this.config.protocolSpecific?.pingInterval || 30000;
    const heartbeatInterval = this.config.protocolSpecific?.heartbeatInterval || 60000;

    // Ping interval
    this.pingInterval = setInterval(() => {
      this.pingAllConnections();
    }, pingInterval);

    // Heartbeat check interval
    this.heartbeatInterval = setInterval(() => {
      this.cleanupDeadConnections();
    }, heartbeatInterval);
  }

  /**
   * 向所有连接发送ping
   */
  private pingAllConnections(): void {
    for (const [connectionId, connection] of this.connections) {
      if (connection.readyState === WS.WebSocket.OPEN) {
        try {
          connection.ping();
          const metadata = this.connectionMetadata.get(connectionId) as WebSocketConnectionMetadata;
          if (metadata) {
            metadata.lastPingTime = Date.now();
            metadata.isAlive = false; // 将在pong时设为true
          }
        } catch (error) {
          this.logger.debug('Failed to ping connection', {}, { connectionId, error });
        }
      }
    }
  }

  /**
   * 清理死连接
   */
  private cleanupDeadConnections(): void {
    const connectionsToRemove: WS.WebSocket[] = [];
    
    for (const [connectionId, connection] of this.connections) {
      const metadata = this.connectionMetadata.get(connectionId) as WebSocketConnectionMetadata;
      
      if (!metadata || !this.isConnectionHealthy(connection)) {
        connectionsToRemove.push(connection);
      }
    }

    // 异步清理
    connectionsToRemove.forEach(connection => {
      this.removeConnection(connection, 'Dead connection cleanup').catch(error => {
        this.logger.error('Error cleaning up dead connection', {}, error);
      });
    });

    if (connectionsToRemove.length > 0) {
      this.logger.debug('Cleaned up dead WebSocket connections', {}, { 
        count: connectionsToRemove.length 
      });
    }
  }

  /**
   * 清理过期连接
   */
  cleanupStaleConnections(): number {
    const now = Date.now();
    const staleTimeout = this.config.connectionTimeout || 300000; // 5分钟
    const connectionsToRemove: WS.WebSocket[] = [];

    for (const [connectionId, metadata] of this.connectionMetadata) {
      const wsMetadata = metadata as WebSocketConnectionMetadata;
      
      // 检查连接是否过期
      if (wsMetadata.available && (now - wsMetadata.lastUsed) > staleTimeout) {
        const connection = this.connections.get(connectionId);
        if (connection) {
          connectionsToRemove.push(connection);
        }
      }
    }

    // 异步清理
    connectionsToRemove.forEach(connection => {
      this.removeConnection(connection, 'Stale connection cleanup').catch(error => {
        this.logger.error('Error cleaning up stale connection', {}, error);
      });
    });

    return connectionsToRemove.length;
  }

  /**
   * 获取连接统计信息
   */
  getConnectionStats() {
    const stats = this.getMetrics();
    const activeConnections = this.getActiveConnectionCount();
    
    let availableConnections = 0;
    let healthyConnections = 0;
    
    for (const [connectionId, connection] of this.connections) {
      const metadata = this.connectionMetadata.get(connectionId) as WebSocketConnectionMetadata;
      
      if (metadata?.available) {
        availableConnections++;
      }
      
      if (this.isConnectionHealthy(connection)) {
        healthyConnections++;
      }
    }
    
    return {
      ...stats,
      availableConnections,
      healthyConnections,
      utilizationRatio: this.config.maxConnections ? 
        activeConnections / this.config.maxConnections : 0
    };
  }

  /**
   * 找到连接ID的辅助方法
   */
  private findWebSocketConnectionId(connection: WS.WebSocket): string | null {
    for (const [id, conn] of this.connections) {
      if (conn === connection) return id;
    }
    return null;
  }

  /**
   * 销毁连接池
   */
  async destroy(): Promise<void> {
    // 停止心跳监控
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // 调用父类销毁方法
    await super.destroy();
  }
} 