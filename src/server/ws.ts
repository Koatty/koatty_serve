/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2024-11-27 21:20:00
 */
import { Server as HttpServer, IncomingMessage, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { KoattyApplication, NativeServer } from 'koatty_core';
import { ServerOptions, WebSocketServer, WebSocket } from 'ws';
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats, HealthStatus } from "./base";
import { createLogger, generateTraceId } from "../utils/logger";
import { WebSocketConnectionPoolManager } from "./pools/ws";
import { ConnectionPoolConfig, ConnectionPoolEvent } from "./pools/pool";

export interface WebSocketServerOptions extends ListeningOptions {
  wsOptions?: ServerOptions;
  maxConnections?: number; // 最大连接数限制
  connectionTimeout?: number; // 连接超时时间(ms)
  connectionPool?: {
    maxConnections?: number;
    pingInterval?: number;
    pongTimeout?: number;
    heartbeatInterval?: number;
  };
}

export class WsServer extends BaseServer<WebSocketServerOptions> {
  readonly server: WebSocketServer;
  readonly httpServer: HttpServer | HttpsServer;
  private connectionPool: WebSocketConnectionPoolManager;
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

    this.logger.info('Initializing WebSocket server with connection pool', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      maxConnections: options.connectionPool?.maxConnections || options.maxConnections || 1000,
      connectionTimeout: options.connectionTimeout || 30000
    });

    // 初始化连接池
    this.initializeConnectionPool();

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

    // 设置连接池事件监听
    this.setupConnectionPoolEventListeners();

    // Set up periodic cleanup of stale connections
    this.cleanupInterval = setInterval(() => {
      const cleaned = this.connectionPool.cleanupStaleConnections();
      if (cleaned > 0) {
        this.logger.debug('Cleaned up stale WebSocket connections', {}, { count: cleaned });
      }
    }, 10000); // Check every 10 seconds

    this.logger.debug('WebSocket server initialized successfully');

    CreateTerminus(this);
  }

  /**
   * 初始化连接池
   */
  private initializeConnectionPool(): void {
    const poolConfig: ConnectionPoolConfig = this.extractConnectionPoolConfig();
    this.connectionPool = new WebSocketConnectionPoolManager(poolConfig);
  }

  /**
   * 提取连接池配置
   */
  private extractConnectionPoolConfig(): ConnectionPoolConfig {
    const options = this.options.connectionPool;
    return {
      maxConnections: options?.maxConnections || this.options.maxConnections,
      connectionTimeout: this.options.connectionTimeout || 30000,
      protocolSpecific: {
        pingInterval: options?.pingInterval,
        pongTimeout: options?.pongTimeout
      }
    };
  }

  /**
   * 设置连接池事件监听
   */
  private setupConnectionPoolEventListeners(): void {
    this.connectionPool.on(ConnectionPoolEvent.POOL_LIMIT_REACHED, (data: any) => {
      this.logger.warn('WebSocket connection pool limit reached', {}, data);
    });

    this.connectionPool.on(ConnectionPoolEvent.HEALTH_STATUS_CHANGED, (data: any) => {
      this.logger.info('WebSocket connection pool health status changed', {}, data);
    });

    this.connectionPool.on(ConnectionPoolEvent.CONNECTION_ERROR, (data: any) => {
      this.logger.warn('WebSocket connection pool error', {}, {
        error: data.error?.message,
        connectionId: data.connectionId
      });
    });
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
      
      // Update connection pool limits
      if (newConfig.maxConnections) {
        (this.connectionPool as any).maxConnections = newConfig.maxConnections;
      }
      if (newConfig.connectionTimeout) {
        (this.connectionPool as any).connectionTimeout = newConfig.connectionTimeout;
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
      activeConnections: this.connectionPool.getActiveConnectionCount(),
      timeout: timeout
    });

    const startTime = Date.now();
    
    while (this.connectionPool.getActiveConnectionCount() > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        this.logger.warn('Connection completion timeout reached', { traceId }, {
          remainingConnections: this.connectionPool.getActiveConnectionCount(),
          elapsed: elapsed
        });
        break;
      }
      
      // Log progress every 5 seconds
      if (elapsed % 5000 < 100) {
        this.logger.debug('Waiting for connections to complete', { traceId }, {
          remainingConnections: this.connectionPool.getActiveConnectionCount(),
          elapsed: elapsed
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('Connection completion wait finished', { traceId }, {
      remainingConnections: this.connectionPool.getActiveConnectionCount()
    });
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    const remainingConnections = this.connectionPool.getActiveConnectionCount();
    
    if (remainingConnections > 0) {
      this.logger.info('Step 4: Force closing remaining connections', { traceId }, {
        remainingConnections
      });
      
      // Force close all remaining connections
      await this.connectionPool.closeAllConnections(5000);
      
      this.logger.warn('Forced closure of remaining connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining connections to close', { traceId });
    }
  }

  protected stopMonitoringAndCleanup(traceId: string): void {
    this.logger.info('Step 5: Stopping monitoring and cleanup', { traceId });
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    // Log final connection statistics
    const finalStats = this.connectionPool.getMetrics();
    this.logger.info('Final connection statistics', { traceId }, finalStats);
    
    this.logger.debug('Monitoring stopped and cleanup completed', { traceId });
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force shutdown initiated', { traceId });
    
    // Force close the HTTP server
    this.httpServer.close();
    
    // Force close all WebSocket connections
    this.connectionPool.closeAllConnections(1000);
    
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.connectionPool.getActiveConnectionCount();
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
    return this.connectionPool.getMetrics();
  }

  getConnectionsStatus(): { current: number; max: number } {
    return {
      current: this.connectionPool.getActiveConnectionCount(),
      max: this.options.maxConnections || 1000
    };
  }

  /**
   * Handle WebSocket connection
   */
  private onConnection(ws: WebSocket, request: IncomingMessage): void {
    // Check connection limits and add to manager
    if (!this.connectionPool.addConnection(ws, {
      remoteAddress: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      url: request.url
    })) {
      ws.close(1013, 'Server overloaded');
      return;
    }

    const connectionInfo = this.connectionPool.getConnectionInfo(ws);
    const connectionContext = connectionInfo ? {
      connectionId: connectionInfo.connectionId,
      traceId: generateTraceId()
    } : {};
    
    const clientInfo = {
      url: request.url,
      userAgent: request.headers['user-agent'],
      origin: request.headers.origin,
      ip: request.socket.remoteAddress
    };

    this.logger.logConnectionEvent('connected', connectionContext, clientInfo);

    // Handle messages
    ws.on('message', (message: Buffer) => {
      this.connectionPool.updateConnectionActivity(ws);
      
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
      this.connectionPool.removeConnection(ws);
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      this.logger.logConnectionEvent('error', connectionContext, error);
      this.connectionPool.removeConnection(ws);
    });

    // 触发应用层的连接事件
    this.app.emit('websocket_connection', ws, request);
  }

  // ============= 实现健康检查和指标收集 =============

  protected async performProtocolHealthChecks(): Promise<Record<string, any>> {
    const checks: Record<string, any> = {};
    
    // WebSocket server specific health checks
    const nativeServer = (this.httpServer as any).server || this.httpServer;
    const serverListening = nativeServer.listening;
    
    checks.server = {
      status: serverListening ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      message: serverListening ? 'WebSocket server is listening' : 'WebSocket server is not listening',
      details: {
        listening: serverListening,
        protocol: this.options.protocol,
        serverId: this.serverId
      }
    };

    // Connection pool health check
    const connectionStats = this.connectionPool.getMetrics();
    const maxConnections = this.options.maxConnections || 1000;
    const utilizationRatio = connectionStats.activeConnections / maxConnections;
    
    checks.connectionPool = {
      status: utilizationRatio > 0.9 
        ? HealthStatus.DEGRADED 
        : utilizationRatio > 0.95 
          ? HealthStatus.UNHEALTHY 
          : HealthStatus.HEALTHY,
      message: `Connection pool utilization: ${(utilizationRatio * 100).toFixed(1)}%`,
      details: {
        activeConnections: connectionStats.activeConnections,
        maxConnections,
        utilizationRatio: utilizationRatio.toFixed(3),
        freeConnections: maxConnections - connectionStats.activeConnections
      }
    };

    // WebSocket performance health
    const errorRate = connectionStats.errorRate;
    checks.performance = {
      status: errorRate > 0.1 
        ? HealthStatus.UNHEALTHY 
        : errorRate > 0.05 
          ? HealthStatus.DEGRADED 
          : HealthStatus.HEALTHY,
      message: `WebSocket error rate: ${(errorRate * 100).toFixed(2)}%`,
      details: connectionStats
    };
    
    return checks;
  }

  protected collectProtocolMetrics(): Record<string, any> {
    const connectionStats = this.connectionPool.getMetrics();
    const nativeServer = (this.httpServer as any).server || this.httpServer;
    
    return {
      protocol: this.options.protocol,
      server: {
        listening: nativeServer.listening,
        serverId: this.serverId,
        address: nativeServer.address()
      },
      connectionPool: {
        enabled: true,
        maxConnections: this.options.maxConnections || 1000,
        activeConnections: connectionStats.activeConnections,
        totalConnections: connectionStats.totalConnections,
        utilizationRatio: (connectionStats.activeConnections / (this.options.maxConnections || 1000)).toFixed(3),
        configuration: {
          maxConnections: this.options.maxConnections || 1000,
          connectionTimeout: this.options.connectionTimeout || 30000
        }
      },
      performance: {
        connectionsPerSecond: connectionStats.connectionsPerSecond,
        averageLatency: connectionStats.averageLatency,
        errorRate: connectionStats.errorRate,
        connectionStats: connectionStats
      }
    };
  }
}
