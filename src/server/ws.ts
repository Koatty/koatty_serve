/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2025-04-08 10:48:00
 */
import { Server as HttpServer, IncomingMessage, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { KoattyApplication, NativeServer } from 'koatty_core';
import { ServerOptions, WebSocketServer, WebSocket } from 'ws';
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats } from "./base";
import { createLogger, generateConnectionId, generateTraceId, LogContext } from "../utils/structured-logger";

export interface WebSocketServerOptions extends ListeningOptions {
  wsOptions?: ServerOptions;
  maxConnections?: number; // 最大连接数限制
  connectionTimeout?: number; // 连接超时时间(ms)
}

/**
 * WebSocket connection manager with structured logging
 */
class ConnectionManager {
  private connections = new Set<WebSocket>();
  private connectionData = new WeakMap<WebSocket, { 
    connectTime: number; 
    lastActivity: number;
    connectionId: string;
    traceId: string;
  }>();
  private logger = createLogger({ module: 'websocket', action: 'connection_manager' });
  private stats: ConnectionStats = {
    activeConnections: 0,
    totalConnections: 0,
    connectionsPerSecond: 0,
    averageLatency: 0,
    errorRate: 0
  };
  private startTime = Date.now();
  
  constructor(
    private maxConnections: number = 1000,
    private connectionTimeout: number = 30000 // 30秒超时
  ) {
    this.logger.info('Connection manager initialized', {}, {
      maxConnections: this.maxConnections,
      connectionTimeout: this.connectionTimeout
    });
  }

  /**
   * Add new connection
   */
  addConnection(ws: WebSocket): boolean {
    if (this.connections.size >= this.maxConnections) {
      this.logger.logSecurityEvent('rate_limit', {}, {
        reason: 'max_connections_reached',
        current: this.connections.size,
        limit: this.maxConnections
      });
      return false;
    }

    const connectionId = generateConnectionId();
    const traceId = generateTraceId();
    
    this.connections.add(ws);
    this.connectionData.set(ws, {
      connectTime: Date.now(),
      lastActivity: Date.now(),
      connectionId,
      traceId
    });

    this.stats.activeConnections++;
    this.stats.totalConnections++;

    this.logger.logConnectionEvent('connected', { connectionId, traceId }, {
      totalConnections: this.connections.size,
      maxConnections: this.maxConnections
    });
    
    return true;
  }

  /**
   * Remove connection
   */
  removeConnection(ws: WebSocket): void {
    const data = this.connectionData.get(ws);
    
    if (this.connections.has(ws)) {
      this.connections.delete(ws);
      this.connectionData.delete(ws);
      this.stats.activeConnections--;
      
      if (data) {
        const duration = Date.now() - data.connectTime;
        this.logger.logConnectionEvent('disconnected', {
          connectionId: data.connectionId,
          traceId: data.traceId
        }, {
          duration: `${duration}ms`,
          totalConnections: this.connections.size,
          maxConnections: this.maxConnections
        });
      }
    }
  }

  /**
   * Update connection activity
   */
  updateActivity(ws: WebSocket): void {
    const data = this.connectionData.get(ws);
    if (data) {
      data.lastActivity = Date.now();
    }
  }

  /**
   * Get connection context for logging
   */
  getConnectionContext(ws: WebSocket): LogContext {
    const data = this.connectionData.get(ws);
    return data ? {
      connectionId: data.connectionId,
      traceId: data.traceId
    } : {};
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    const now = Date.now();
    const timeDiff = (now - this.startTime) / 1000;
    
    if (timeDiff > 0) {
      this.stats.connectionsPerSecond = this.stats.totalConnections / timeDiff;
    }
    
    return { ...this.stats };
  }

  /**
   * Close all connections
   */
  closeAllConnections(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connections.size === 0) {
        this.logger.info('No connections to close');
        resolve();
        return;
      }

      let closedCount = 0;
      const totalConnections = this.connections.size;

      this.logger.info('Closing all connections', {}, {
        totalConnections
      });

      this.connections.forEach((ws) => {
        const data = this.connectionData.get(ws);
        const context = data ? { connectionId: data.connectionId, traceId: data.traceId } : {};

        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Server shutting down');
          this.logger.debug('Sent close signal to connection', context);
        }
        
        const cleanup = () => {
          this.removeConnection(ws);
          closedCount++;
          if (closedCount >= totalConnections) {
            this.logger.info('All connections closed successfully');
            resolve();
          }
        };

        // Set timeout in case close event doesn't fire
        setTimeout(cleanup, 1000);
        
        ws.once('close', cleanup);
      });

      // Fallback timeout
      setTimeout(() => {
        if (closedCount < totalConnections) {
          const forceClosed = totalConnections - closedCount;
          this.logger.warn('Force closing connections due to timeout', {}, {
            forceClosed,
            totalConnections
          });
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections(): void {
    const now = Date.now();
    const staleConnections: { ws: WebSocket; data: any }[] = [];

    this.connections.forEach((ws) => {
      const data = this.connectionData.get(ws);
      if (data && (now - data.lastActivity) > this.connectionTimeout) {
        staleConnections.push({ ws, data });
      }
    });

    if (staleConnections.length > 0) {
      this.logger.info('Cleaning up stale connections', {}, {
        staleCount: staleConnections.length,
        timeout: this.connectionTimeout
      });

      staleConnections.forEach(({ ws, data }) => {
        this.logger.logConnectionEvent('timeout', {
          connectionId: data.connectionId,
          traceId: data.traceId
        }, {
          inactiveTime: now - data.lastActivity
        });
        
        ws.close(1000, 'Connection timeout');
        this.removeConnection(ws);
      });
    }
  }
}

export class WsServer extends BaseServer<WebSocketServerOptions> {
  readonly server: WebSocketServer;
  readonly httpServer: HttpServer | HttpsServer;
  private connectionManager: ConnectionManager;
  private cleanupInterval?: NodeJS.Timeout;
  private upgradeHandler?: (request: any, socket: any, head: any) => void;
  private clientErrorHandler?: (err: any, sock: any) => void;
  protected logger = createLogger({ module: 'websocket', protocol: 'ws' });
  private serverId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  socket: any;

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, options);
    options.ext = options.ext || {};
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'websocket', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    // Initialize connection manager
    this.connectionManager = new ConnectionManager(
      options.maxConnections || 1000,
      options.connectionTimeout || 30000
    );

    this.logger.info('Initializing WebSocket server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      maxConnections: options.maxConnections || 1000,
      connectionTimeout: options.connectionTimeout || 30000
    });

    if (options.ext.server){
      this.httpServer = options.ext.server;
      this.logger.debug('Using external HTTP server');
    } else {
      if (this.options.protocol == "wss") {
        const opt: httpsServerOptions = {
          key: this.options.ext.key,
          cert: this.options.ext.cert,
        };
        this.httpServer = httpsCreateServer(opt);
        this.logger.debug('Created HTTPS server for WSS');
      } else {
        this.httpServer = createServer();
        this.logger.debug('Created HTTP server for WS');
      }
    }

    // Configure WebSocket server with noServer: true to handle upgrade manually
    this.options.wsOptions = {
      noServer: true,
    };

    this.server = new WebSocketServer(this.options.wsOptions);

    // Set up periodic cleanup of stale connections
    this.cleanupInterval = setInterval(() => {
      this.connectionManager.cleanupStaleConnections();
    }, 10000); // Check every 10 seconds

    this.logger.debug('WebSocket server initialized successfully');

    CreateTerminus(this);
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    oldConfig: WebSocketServerOptions,
    newConfig: WebSocketServerOptions
  ): ConfigChangeAnalysis {
    // Critical changes that require restart for WebSocket server
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    if (changedKeys.some(key => criticalKeys.includes(key))) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false
      };
    }

    // SSL certificate changes (for WSS)
    if (this.hasSSLConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'SSL certificate configuration changed',
        canApplyRuntime: false
      };
    }

    // Connection pool changes
    if (this.hasConnectionConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: false,
        changedKeys,
        canApplyRuntime: true
      };
    }

    return {
      requiresRestart: false,
      changedKeys,
      canApplyRuntime: true
    };
  }

  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ): void {
    // This is now handled by the base class's restart logic
    this.options = { ...this.options, ...newConfig };
  }

  protected onRuntimeConfigChange(
    analysis: ConfigChangeAnalysis,
    newConfig: Partial<WebSocketServerOptions>,
    traceId: string
  ): void {
    // Handle WebSocket-specific runtime changes
    if (newConfig.maxConnections || newConfig.connectionTimeout) {
      this.logger.info('Updating connection management configuration', { traceId }, {
        oldMaxConnections: this.options.maxConnections,
        newMaxConnections: newConfig.maxConnections,
        oldTimeout: this.options.connectionTimeout,
        newTimeout: newConfig.connectionTimeout
      });
      
      // Update connection manager limits
      if (newConfig.maxConnections) {
        (this.connectionManager as any).maxConnections = newConfig.maxConnections;
      }
      if (newConfig.connectionTimeout) {
        (this.connectionManager as any).connectionTimeout = newConfig.connectionTimeout;
      }
    }

    this.logger.debug('WebSocket runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: WebSocketServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      maxConnections: config.maxConnections,
      connectionTimeout: config.connectionTimeout,
      ssl: config.protocol === 'wss' ? {
        keyFile: config.ext?.key,
        certFile: config.ext?.cert
      } : null
    };
  }

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new connections', { traceId });
    
    // Close the HTTP server to stop accepting new connections
    this.httpServer.close();
    
    this.logger.debug('New connection acceptance stopped', { traceId });
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Step 3: Waiting for existing connections to complete', { traceId }, {
      activeConnections: this.connectionManager.getConnectionCount(),
      timeout: timeout
    });

    const startTime = Date.now();
    
    while (this.connectionManager.getConnectionCount() > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        this.logger.warn('Connection completion timeout reached', { traceId }, {
          remainingConnections: this.connectionManager.getConnectionCount(),
          elapsed: elapsed
        });
        break;
      }
      
      // Log progress every 5 seconds
      if (elapsed % 5000 < 100) {
        this.logger.debug('Waiting for connections to complete', { traceId }, {
          remainingConnections: this.connectionManager.getConnectionCount(),
          elapsed: elapsed
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('Connection completion wait finished', { traceId }, {
      remainingConnections: this.connectionManager.getConnectionCount()
    });
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    const remainingConnections = this.connectionManager.getConnectionCount();
    
    if (remainingConnections > 0) {
      this.logger.info('Step 4: Force closing remaining connections', { traceId }, {
        remainingConnections
      });
      
      // Force close all remaining connections
      await this.connectionManager.closeAllConnections();
      
      this.logger.warn('Forced closure of remaining connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining connections to close', { traceId });
    }
  }

  protected stopMonitoringAndCleanup(traceId: string): void {
    this.logger.info('Step 5: Stopping monitoring and cleanup', { traceId });
    
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    // Log final connection statistics
    const finalStats = this.connectionManager.getStats();
    this.logger.info('Final connection statistics', { traceId }, finalStats);
    
    this.logger.debug('Monitoring stopped and cleanup completed', { traceId });
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force shutdown initiated', { traceId });
    
    // Force close HTTP server
    this.httpServer.close();
    
    // Force close all WebSocket connections
    this.connectionManager.closeAllConnections();
    
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.connectionManager.getConnectionCount();
  }

  // ============= WebSocket 特有的辅助方法 =============

  private hasSSLConfigChanged(oldConfig: WebSocketServerOptions, newConfig: WebSocketServerOptions): boolean {
    if (oldConfig.protocol !== 'wss' && newConfig.protocol !== 'wss') {
      return false;
    }

    const oldSSL = oldConfig.ext;
    const newSSL = newConfig.ext;

    if (!oldSSL && !newSSL) return false;
    if (!oldSSL || !newSSL) return true;

    return (
      oldSSL.key !== newSSL.key ||
      oldSSL.cert !== newSSL.cert
    );
  }

  private hasConnectionConfigChanged(oldConfig: WebSocketServerOptions, newConfig: WebSocketServerOptions): boolean {
    return (
      oldConfig.maxConnections !== newConfig.maxConnections ||
      oldConfig.connectionTimeout !== newConfig.connectionTimeout
    );
  }

  // ============= 覆盖 BaseServer 的 Stop 方法以保持兼容性 =============

  /**
   * Stop Server (override to maintain backward compatibility)
   */
  Stop(callback?: () => void): void {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId });

    this.gracefulShutdown()
      .then(() => {
        this.logger.logServerEvent('stopped', { traceId }, { 
          gracefulShutdown: true,
          finalConnectionCount: this.getActiveConnectionCount()
        });
        if (callback) callback();
      })
      .catch((err: Error) => {
        this.logger.error('Graceful shutdown failed, attempting force shutdown', { traceId }, err);
        
        // 回退到强制关闭
        this.forceShutdown(traceId);
        
        this.logger.logServerEvent('stopped', { traceId }, { 
          forcedShutdown: true,
          finalConnectionCount: this.getActiveConnectionCount()
        });
        
        if (callback) callback();
      });
  }

  // ============= 原有的 WebSocket 功能方法 =============

  /**
   * Return an HTTP server
   */
  Start(): NativeServer {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    // Set up upgrade handler for HTTP server
    this.upgradeHandler = (request: IncomingMessage, socket: any, head: Buffer) => {
      try {
        this.server.handleUpgrade(request, socket, head, (ws) => {
          this.onConnection(ws, request);
        });
      } catch (error) {
        this.logger.error('WebSocket upgrade failed', { traceId }, error);
        socket.destroy();
      }
    };

    // Set up client error handler
    this.clientErrorHandler = (err: Error, socket: any) => {
      this.logger.error('HTTP client error', { traceId }, err);
      socket.destroy();
    };

    (this.httpServer as any).on('upgrade', this.upgradeHandler);
    (this.httpServer as any).on('clientError', this.clientErrorHandler);

    return this.httpServer.listen(this.options.port, this.options.hostname, () => {
      const addr = this.httpServer.address();
      this.logger.logServerEvent('started', { traceId }, {
        address: addr,
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol
      });
    }).on("error", (err: Error) => {
      this.logger.logServerEvent('error', { traceId }, err);
    });
  }

  /**
   * Get status
   * @returns 
   */
  getStatus(): number {
    return this.status;
  }

  /**
   * Get native server
   * @returns 
   */
  getNativeServer(): NativeServer {
    return this.httpServer;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    return this.connectionManager.getStats();
  }

  getConnectionsStatus(): { current: number; max: number } {
    return {
      current: this.connectionManager.getConnectionCount(),
      max: this.options.maxConnections || 1000
    };
  }

  /**
   * Handle WebSocket connection
   */
  private onConnection(ws: WebSocket, request: IncomingMessage): void {
    // Check connection limits and add to manager
    if (!this.connectionManager.addConnection(ws)) {
      ws.close(1013, 'Server overloaded');
      return;
    }

    const connectionContext = this.connectionManager.getConnectionContext(ws);
    const clientInfo = {
      url: request.url,
      userAgent: request.headers['user-agent'],
      origin: request.headers.origin,
      ip: request.socket.remoteAddress
    };

    this.logger.logConnectionEvent('connected', connectionContext, clientInfo);

    // Handle messages
    ws.on('message', (message: Buffer) => {
      this.connectionManager.updateActivity(ws);
      
      try {
        this.logger.debug('Message received', connectionContext, {
          size: message.length,
          type: typeof message
        });
        
        // 触发应用层的消息处理
        this.app.emit('websocket_message', ws, message, request);
      } catch (error) {
        this.logger.logConnectionEvent('error', connectionContext, error);
      }
    });

    // Handle connection close
    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.debug('Connection closing', connectionContext, {
        code,
        reason: reason.toString()
      });
      this.connectionManager.removeConnection(ws);
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      this.logger.logConnectionEvent('error', connectionContext, error);
      this.connectionManager.removeConnection(ws);
    });

    // 触发应用层的连接事件
    this.app.emit('websocket_connection', ws, request);
  }
}
