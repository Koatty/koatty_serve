/*
 * @Description: HTTP Server implementation using template method pattern
 * @Usage: HTTP协议服务器实现
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 23:00:00
 */
import { createServer, Server } from "http";
import { KoattyApplication, NativeServer } from "koatty_core";
import { generateTraceId } from "../utils/logger";
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ConfigChangeAnalysis } from "./base";
import { HttpConnectionPoolManager } from "../pools/http";
import { ConnectionPoolConfig } from "../config/pool";
import { ConfigHelper, HttpServerOptions, ListeningOptions } from "../config/config";


/**
 * HTTP Server implementation using template method pattern
 * 继承BaseServer，只实现HTTP特定的逻辑
 */
export class HttpServer extends BaseServer<HttpServerOptions> {
  declare readonly server: Server;
  declare protected connectionPool: HttpConnectionPoolManager;

  constructor(app: KoattyApplication, options: HttpServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createHttpConfig(app, options);
    CreateTerminus(app, this);
  }

  /**
   * 初始化HTTP连接池
   */
  protected initializeConnectionPool(): void {
    const poolConfig: ConnectionPoolConfig = this.extractConnectionPoolConfig();
    this.connectionPool = new HttpConnectionPoolManager(poolConfig);
    
    this.logger.debug('HTTP connection pool initialized', {}, {
      maxConnections: poolConfig.maxConnections || 'unlimited',
      keepAliveTimeout: poolConfig.keepAliveTimeout || 5000,
      headersTimeout: poolConfig.headersTimeout || 60000,
      requestTimeout: poolConfig.requestTimeout || 300000
    });
  }

  /**
   * 创建HTTP服务器实例
   */
  protected createProtocolServer(): void {
    (this as any).server = createServer((req, res) => {
      this.app.callback()(req, res);
      
      // 记录请求指标
      res.on('finish', () => {
        if (req.socket) {
          this.connectionPool.handleRequestComplete(
            req.socket, 
            res.getHeaders()['content-length'] as number || 0
          ).catch(error => {
            this.logger.debug('Error handling request complete', {}, error);
          });
        }
      });
    });

    this.logger.debug('HTTP server instance created');
  }

  /**
   * 配置HTTP服务器选项
   */
  protected configureServerOptions(): void {
    this.configureConnectionPoolSettings();
    this.setupConnectionTracking();
  }

  /**
   * HTTP特定的额外初始化
   */
  protected performProtocolSpecificInitialization(): void {
    this.logger.info('HTTP server initialization completed', {}, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol,
      serverId: this.serverId
    });
  }

  // ============= HTTP特定的私有方法 =============

  /**
   * 提取连接池配置
   */
  private extractConnectionPoolConfig(): ConnectionPoolConfig {
    const options = this.options.connectionPool;
    return {
      maxConnections: options?.maxConnections,
      connectionTimeout: 30000, // 30秒连接超时
      keepAliveTimeout: options?.keepAliveTimeout,
      requestTimeout: options?.requestTimeout,
      headersTimeout: options?.headersTimeout
    };
  }

  /**
   * 配置连接池设置
   */
  private configureConnectionPoolSettings(): void {
    const poolConfig = this.options.connectionPool;
    
    if (!poolConfig) {
      this.logger.debug('No connection pool configuration provided, using defaults');
      return;
    }

    // 应用Keep-Alive超时
    if (poolConfig.keepAliveTimeout !== undefined) {
      this.server.keepAliveTimeout = poolConfig.keepAliveTimeout;
      this.logger.debug('Set keep-alive timeout', {}, {
        keepAliveTimeout: poolConfig.keepAliveTimeout
      });
    }

    // 应用请求头超时
    if (poolConfig.headersTimeout !== undefined) {
      this.server.headersTimeout = poolConfig.headersTimeout;
      this.logger.debug('Set headers timeout', {}, {
        headersTimeout: poolConfig.headersTimeout
      });
    }

    // 应用请求超时
    if (poolConfig.requestTimeout !== undefined) {
      this.server.requestTimeout = poolConfig.requestTimeout;
      this.logger.debug('Set request timeout', {}, {
        requestTimeout: poolConfig.requestTimeout
      });
    }

    this.logger.info('HTTP connection pool configured successfully', {}, {
      maxConnections: poolConfig.maxConnections || 'unlimited',
      keepAliveTimeout: poolConfig.keepAliveTimeout || this.server.keepAliveTimeout,
      headersTimeout: poolConfig.headersTimeout || this.server.headersTimeout,
      requestTimeout: poolConfig.requestTimeout || this.server.requestTimeout
    });
  }

  /**
   * 设置连接跟踪
   */
  private setupConnectionTracking(): void {
    // 增强的连接跟踪，集成连接池管理
    this.server.on('connection', (socket) => {
      // 使用连接池管理连接
      this.connectionPool.addHttpConnection(socket).catch(error => {
        this.logger.error('Failed to add connection to pool', {}, error);
        socket.destroy();
      });
    });
  }

  // ============= 实现配置管理抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof HttpServerOptions)[],
    oldConfig: HttpServerOptions,
    newConfig: HttpServerOptions
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

    // 连接池配置变更
    if (this.hasConnectionPoolChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        restartReason: 'Connection pool configuration changed',
        canApplyRuntime: false
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
    newConfig: Partial<HttpServerOptions>,
    traceId: string
  ): void {
    // 处理HTTP特定的运行时配置变更
    const httpConfig = newConfig as Partial<HttpServerOptions>;
    
    // 更新连接池限制（如果支持）
    if (httpConfig.connectionPool?.maxConnections) {
      this.logger.info('Updating connection pool limits', { traceId }, {
        oldLimit: 'current',
        newLimit: httpConfig.connectionPool.maxConnections
      });
      // 注意：这需要额外的实现来实际执行限制
    }

    this.logger.debug('HTTP runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: HttpServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      connectionPool: config.connectionPool ? {
        maxConnections: config.connectionPool.maxConnections,
        keepAliveTimeout: config.connectionPool.keepAliveTimeout,
        headersTimeout: config.connectionPool.headersTimeout,
        requestTimeout: config.connectionPool.requestTimeout
      } : null
    };
  }

  /**
   * 检查连接池配置是否变更
   */
  private hasConnectionPoolChanged(oldConfig: HttpServerOptions, newConfig: HttpServerOptions): boolean {
    const oldPool = oldConfig.connectionPool;
    const newPool = newConfig.connectionPool;

    if (!oldPool && !newPool) return false;
    if (!oldPool || !newPool) return true;

    return (
      oldPool.maxConnections !== newPool.maxConnections ||
      oldPool.keepAliveTimeout !== newPool.keepAliveTimeout ||
      oldPool.headersTimeout !== newPool.headersTimeout ||
      oldPool.requestTimeout !== newPool.requestTimeout
    );
  }

  // ============= 实现优雅关闭抽象方法 =============

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new HTTP connections', { traceId });
    
    // HTTP服务器停止监听新连接
    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    this.logger.debug('New HTTP connection acceptance stopped', { traceId });
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Step 3: Waiting for existing HTTP connections to complete', { traceId }, {
      activeConnections: this.getActiveConnectionCount(),
      timeout: timeout
    });

    const startTime = Date.now();
    
    while (this.getActiveConnectionCount() > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        this.logger.warn('HTTP connection completion timeout reached', { traceId }, {
          remainingConnections: this.getActiveConnectionCount(),
          elapsed: elapsed
        });
        break;
      }
      
      // 每5秒记录一次进度
      if (elapsed % 5000 < 100) {
        this.logger.debug('Waiting for HTTP connections to complete', { traceId }, {
          remainingConnections: this.getActiveConnectionCount(),
          elapsed: elapsed
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('HTTP connection completion wait finished', { traceId }, {
      remainingConnections: this.getActiveConnectionCount()
    });
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    const remainingConnections = this.getActiveConnectionCount();
    
    if (remainingConnections > 0) {
      this.logger.info('Step 4: Force closing remaining HTTP connections', { traceId }, {
        remainingConnections
      });
      
      // 使用连接池强制关闭所有连接
      await this.connectionPool.closeAllConnections(5000);
      
      this.logger.warn('Forced closure of remaining HTTP connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining HTTP connections to close', { traceId });
    }
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force HTTP server shutdown initiated', { traceId });
    
    // 强制关闭HTTP服务器
    this.server.close();
    
    // 停止监控和清理
    this.stopMonitoringAndCleanup(traceId);
  }

  // ============= 实现KoattyServer接口 =============

  Start(listenCallback?: () => void): Server {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    const finalCallback = listenCallback || this.listenCallback;
    
    this.server.listen(this.options.port, this.options.hostname, () => {
      this.logger.logServerEvent('started', { traceId }, {
        address: `${this.options.hostname}:${this.options.port}`,
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol,
        connectionPoolEnabled: !!this.connectionPool,
        serverId: this.serverId
      });
      
      // 启动连接池监控
      this.startConnectionPoolMonitoring();
      
      if (finalCallback) {
        finalCallback();
      }
    });

    return this.server;
  }

  getStatus(): number {
    return this.status;
  }

  getNativeServer(): NativeServer {
    return this.server;
  }

  // ============= HTTP特定的方法 =============

  /**
   * 启动连接池监控
   */
  private startConnectionPoolMonitoring(): void {
    const monitoringInterval = setInterval(() => {
      const stats = this.getConnectionStats();
      this.logger.debug('HTTP connection pool statistics', {}, stats);
    }, 30000); // 每30秒

    // 存储间隔以供清理
    (this.server as any)._monitoringInterval = monitoringInterval;
  }

  /**
   * 获取HTTP连接统计信息
   */
  getHttpConnectionStats() {
    return this.connectionPool ? this.connectionPool.getConnectionStats() : null;
  }
}
