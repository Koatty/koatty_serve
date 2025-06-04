/*
 * @Description: WebSocket Server implementation using template method pattern
 * @Usage: WebSocket协议服务器实现
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2024-11-27 23:30:00
 */
import { Server as HttpServer, IncomingMessage, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { KoattyApplication, NativeServer } from 'koatty_core';
import * as WS from 'ws';
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ConfigChangeAnalysis } from "./base";
import { generateTraceId } from "../utils/logger";
import { WebSocketConnectionPoolManager } from "../pools/ws";
import { ConnectionPoolConfig } from "../config/pool";
import { ConfigHelper, ListeningOptions, WebSocketServerOptions } from "../config/config";


/**
 * WebSocket Server implementation using template method pattern
 * 继承BaseServer，只实现WebSocket特定的逻辑
 */
export class WsServer extends BaseServer<WebSocketServerOptions> {
  declare readonly server: WS.WebSocketServer;
  declare protected connectionPool: WebSocketConnectionPoolManager;
  
  readonly httpServer: HttpServer | HttpsServer;
  private upgradeHandler?: (request: any, socket: any, head: any) => void;
  private clientErrorHandler?: (err: any, sock: any) => void;
  socket: any;

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createWebSocketConfig(options);
    // 创建或使用现有的HTTP/HTTPS服务器
    this.httpServer = this.createHttpServer();
    
    CreateTerminus(app, this);
  }

  /**
   * 初始化WebSocket连接池
   */
  protected initializeConnectionPool(): void {
    const poolConfig: ConnectionPoolConfig = this.extractConnectionPoolConfig();
    this.connectionPool = new WebSocketConnectionPoolManager(poolConfig);
    
    this.logger.debug('WebSocket connection pool initialized', {}, {
      maxConnections: poolConfig.maxConnections || 'unlimited',
      pingInterval: poolConfig.protocolSpecific?.pingInterval || 30000,
      pongTimeout: poolConfig.protocolSpecific?.pongTimeout || 5000,
      heartbeatInterval: poolConfig.protocolSpecific?.heartbeatInterval || 60000
    });
  }

  /**
   * 创建WebSocket服务器实例
   */
  protected createProtocolServer(): void {
    // 配置WebSocket服务器，使用noServer模式手动处理升级
    this.options.wsOptions = {
      ...this.options.wsOptions,
      noServer: true,
    };

    (this as any).server = new WS.WebSocketServer(this.options.wsOptions);
    
    this.logger.debug('WebSocket server instance created');
  }

  /**
   * 配置WebSocket服务器选项
   */
  protected configureServerOptions(): void {
    this.setupUpgradeHandling();
    this.setupConnectionHandling();
  }

  /**
   * WebSocket特定的额外初始化
   */
  protected performProtocolSpecificInitialization(): void {
    this.logger.info('WebSocket server initialization completed', {}, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol,
      serverId: this.serverId,
      isSecure: this.options.protocol === 'wss'
    });
  }

  /**
   * 创建HTTP/HTTPS服务器
   */
  private createHttpServer(): HttpServer | HttpsServer {
    if (this.options.ext?.server) {
      this.logger.debug('Using external HTTP server');
      return this.options.ext.server;
    }
    
    if (this.options.protocol === "wss") {
      const opt: httpsServerOptions = {
        key: this.options.ext?.key,
        cert: this.options.ext?.cert,
      };
      this.logger.debug('Created HTTPS server for WSS');
      return httpsCreateServer(opt);
    } else {
      this.logger.debug('Created HTTP server for WS');
      return createServer();
    }
  }

  /**
   * 提取连接池配置
   */
  private extractConnectionPoolConfig(): ConnectionPoolConfig {
    const options = this.options.connectionPool;
    return {
      maxConnections: options?.maxConnections,
      connectionTimeout: options?.connectionTimeout || 30000,
      protocolSpecific: {
        pingInterval: options?.pingInterval || 30000,
        pongTimeout: options?.pongTimeout || 5000,
        heartbeatInterval: options?.heartbeatInterval || 60000
      }
    };
  }

  /**
   * 设置WebSocket升级处理
   */
  private setupUpgradeHandling(): void {
    this.upgradeHandler = (request: any, socket: any, head: any) => {
      this.server.handleUpgrade(request, socket, head, (ws: WS.WebSocket) => {
        this.server.emit('connection', ws, request);
      });
    };

    this.clientErrorHandler = (err: any, socket: any) => {
      this.logger.error('Client error during upgrade', {}, {
        error: err.message,
        remoteAddress: socket.remoteAddress
      });
      socket.destroy();
    };

    // 绑定升级事件处理器，使用类型断言
    (this.httpServer as any).on('upgrade', this.upgradeHandler);
    (this.httpServer as any).on('clientError', this.clientErrorHandler);
  }

  /**
   * 设置WebSocket连接处理
   */
  private setupConnectionHandling(): void {
    this.server.on('connection', (ws: WS.WebSocket, request: IncomingMessage) => {
      this.onConnection(ws, request).catch(error => {
        this.logger.error('Error handling WebSocket connection', {}, error);
        ws.close(1011, 'Server error');
      });
    });
  }

  /**
   * 处理新的WebSocket连接
   */
  private async onConnection(ws: WS.WebSocket, request: IncomingMessage): Promise<void> {
    const connectionId = generateTraceId();
    
    try {
      // 使用连接池注册连接
      const success = await this.connectionPool.registerConnection(ws, {
        connectionId,
        remoteAddress: request.socket.remoteAddress,
        remotePort: request.socket.remotePort,
        userAgent: request.headers['user-agent'],
        origin: request.headers.origin,
        protocol: request.headers['sec-websocket-protocol'],
        createdAt: Date.now()
      });

      if (!success) {
        this.logger.warn('Failed to register WebSocket connection in pool', {}, { connectionId });
        ws.close(1013, 'Service overloaded');
        return;
      }

      this.logger.debug('New WebSocket connection established', {}, {
        connectionId,
        remoteAddress: request.socket.remoteAddress,
        userAgent: request.headers['user-agent']
      });

      // 设置WebSocket事件处理
      this.setupWebSocketEventHandlers(ws, connectionId);

      // 触发应用层事件
      (this.app as any).emit('connection', ws, request);

    } catch (error) {
      this.logger.error('Failed to handle WebSocket connection', {}, {
        connectionId,
        error: (error as Error).message
      });
      ws.close(1011, 'Server error');
    }
  }

  /**
   * 设置WebSocket事件处理器
   */
  private setupWebSocketEventHandlers(ws: WS.WebSocket, connectionId: string): void {
    // 处理消息
    ws.on('message', (data: WS.RawData) => {
      let dataLength = 0;
      if (Buffer.isBuffer(data)) {
        dataLength = data.length;
      } else if (data instanceof ArrayBuffer) {
        dataLength = data.byteLength;
      } else if (Array.isArray(data)) {
        dataLength = data.reduce((total, chunk) => total + chunk.length, 0);
      }
      
      this.logger.debug('WebSocket message received', {}, {
        connectionId,
        dataLength
      });
    });

    // 处理错误
    ws.on('error', (error: Error) => {
      this.logger.warn('WebSocket connection error', {}, {
        connectionId,
        error: error.message
      });
    });

    // 处理关闭
    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.debug('WebSocket connection closed', {}, {
        connectionId,
        code,
        reason: reason.toString()
      });

      // 从连接池中移除连接
      this.connectionPool.releaseConnection(ws, { destroy: true });
    });

    // 处理pong
    ws.on('pong', () => {
      this.logger.debug('WebSocket pong received', {}, { connectionId });
    });
  }

  protected analyzeConfigChanges(
    changedKeys: (keyof WebSocketServerOptions)[],
    oldConfig: WebSocketServerOptions,
    newConfig: WebSocketServerOptions
  ): ConfigChangeAnalysis {
    // 关键配置变更需要重启
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    if (changedKeys.some(key => criticalKeys.includes(key as keyof ListeningOptions))) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false
      };
    }

    // SSL配置变更 (对于WSS)
    if (this.hasSSLConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        restartReason: 'SSL certificate configuration changed',
        canApplyRuntime: false
      };
    }

    // 连接池配置变更
    if (this.hasConnectionPoolChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: false,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        canApplyRuntime: true
      };
    }

    return {
      requiresRestart: false,
      changedKeys: changedKeys as (keyof ListeningOptions)[],
      canApplyRuntime: true
    };
  }

  protected onRuntimeConfigChange(
    analysis: ConfigChangeAnalysis,
    newConfig: Partial<WebSocketServerOptions>,
    traceId: string
  ): void {
    // 处理WebSocket特定的运行时配置变更
    const wsConfig = newConfig as Partial<WebSocketServerOptions>;
    
    // 更新连接池配置
    if (wsConfig.connectionPool) {
      this.logger.info('Updating WebSocket connection pool configuration', { traceId }, {
        oldConfig: this.options.connectionPool,
        newConfig: wsConfig.connectionPool
      });
      
      // 更新连接池配置
      const newPoolConfig = this.extractConnectionPoolConfig();
      this.connectionPool.updateConfig(newPoolConfig);
    }

    this.logger.debug('WebSocket runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: WebSocketServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      isSecure: config.protocol === 'wss',
      connectionPool: config.connectionPool ? {
        maxConnections: config.connectionPool.maxConnections,
        pingInterval: config.connectionPool.pingInterval,
        pongTimeout: config.connectionPool.pongTimeout,
        heartbeatInterval: config.connectionPool.heartbeatInterval
      } : null,
      wsOptions: config.wsOptions
    };
  }

  /**
   * 检查SSL配置是否变更
   */
  private hasSSLConfigChanged(oldConfig: WebSocketServerOptions, newConfig: WebSocketServerOptions): boolean {
    if (oldConfig.protocol !== 'wss' && newConfig.protocol !== 'wss') return false;
    
    return (
      oldConfig.ext?.key !== newConfig.ext?.key ||
      oldConfig.ext?.cert !== newConfig.ext?.cert ||
      oldConfig.ext?.ca !== newConfig.ext?.ca
    );
  }

  /**
   * 检查连接池配置是否变更
   */
  private hasConnectionPoolChanged(oldConfig: WebSocketServerOptions, newConfig: WebSocketServerOptions): boolean {
    const oldPool = oldConfig.connectionPool;
    const newPool = newConfig.connectionPool;

    if (!oldPool && !newPool) return false;
    if (!oldPool || !newPool) return true;

    return (
      oldPool.maxConnections !== newPool.maxConnections ||
      oldPool.pingInterval !== newPool.pingInterval ||
      oldPool.pongTimeout !== newPool.pongTimeout ||
      oldPool.heartbeatInterval !== newPool.heartbeatInterval
    );
  }

  // ============= 实现优雅关闭抽象方法 =============

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new WebSocket connections', { traceId });
    
    // 移除升级处理器以停止接受新的WebSocket连接
    if (this.upgradeHandler) {
      (this.httpServer as any).removeListener('upgrade', this.upgradeHandler);
      this.logger.debug('WebSocket upgrade handler removed', { traceId });
    }
    
    // 停止HTTP服务器监听
    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    this.logger.debug('New WebSocket connection acceptance stopped', { traceId });
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Step 3: Waiting for existing WebSocket connections to complete', { traceId }, {
      activeConnections: this.getActiveConnectionCount(),
      timeout: timeout
    });

    const startTime = Date.now();
    
    while (this.getActiveConnectionCount() > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        this.logger.warn('WebSocket connection completion timeout reached', { traceId }, {
          remainingConnections: this.getActiveConnectionCount(),
          elapsed: elapsed
        });
        break;
      }
      
      // 每5秒记录一次进度
      if (elapsed % 5000 < 100) {
        this.logger.debug('Waiting for WebSocket connections to complete', { traceId }, {
          remainingConnections: this.getActiveConnectionCount(),
          elapsed: elapsed
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('WebSocket connection completion wait finished', { traceId }, {
      remainingConnections: this.getActiveConnectionCount()
    });
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    const remainingConnections = this.getActiveConnectionCount();
    
    if (remainingConnections > 0) {
      this.logger.info('Step 4: Force closing remaining WebSocket connections', { traceId }, {
        remainingConnections
      });
      
      // 使用连接池强制关闭所有连接
      await this.connectionPool.closeAllConnections(5000);
      
      this.logger.warn('Forced closure of remaining WebSocket connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining WebSocket connections to close', { traceId });
    }
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force WebSocket server shutdown initiated', { traceId });
    
    // 强制关闭WebSocket服务器
    this.server.close();
    
    // 强制关闭HTTP服务器
    this.httpServer.close();
    
    // 停止监控和清理
    this.stopMonitoringAndCleanup(traceId);
  }

  // ============= 实现KoattyServer接口 =============

  Start(): NativeServer {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    this.httpServer.listen(this.options.port, this.options.hostname, () => {
      this.logger.logServerEvent('started', { traceId }, {
        address: `${this.options.hostname}:${this.options.port}`,
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol,
        connectionPoolEnabled: !!this.connectionPool,
        serverId: this.serverId,
        isSecure: this.options.protocol === 'wss'
      });
      
      // 启动连接池监控
      this.startConnectionPoolMonitoring();
    });

    return this.httpServer;
  }

  getStatus(): number {
    return this.status;
  }

  getNativeServer(): NativeServer {
    return this.httpServer;
  }

  // ============= WebSocket特定的方法 =============

  /**
   * 启动连接池监控
   */
  private startConnectionPoolMonitoring(): void {
    const monitoringInterval = setInterval(() => {
      const stats = this.getConnectionStats();
      this.logger.debug('WebSocket connection pool statistics', {}, stats);
    }, 30000); // 每30秒

    // 存储间隔以供清理
    (this.httpServer as any)._monitoringInterval = monitoringInterval;
  }

  /**
   * 获取WebSocket连接统计信息
   */
  getWebSocketConnectionStats() {
    return this.connectionPool ? this.connectionPool.getConnectionStats() : null;
  }

  /**
   * 获取当前连接状态
   */
  getConnectionsStatus(): { current: number; max: number } {
    const poolConfig = this.connectionPool?.getConfig();
    return {
      current: this.getActiveConnectionCount(),
      max: poolConfig?.maxConnections || 0
    };
  }

  /**
   * 销毁服务器
   */
  async destroy(): Promise<void> {
    const traceId = generateTraceId();
    this.logger.info('Destroying WebSocket server', { traceId });

    try {
      await this.gracefulShutdown();
      
      // 清理事件监听器
      if (this.upgradeHandler) {
        (this.httpServer as any).removeListener('upgrade', this.upgradeHandler);
      }
      if (this.clientErrorHandler) {
        (this.httpServer as any).removeListener('clientError', this.clientErrorHandler);
      }
      
      this.logger.info('WebSocket server destroyed successfully', { traceId });
    } catch (error) {
      this.logger.error('Error destroying WebSocket server', { traceId }, error);
      throw error;
    }
  }
}

