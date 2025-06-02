/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 20:40:00
 */
import { createServer, Server } from "http";
import { KoattyApplication, NativeServer } from "koatty_core";
import { createLogger, generateTraceId } from "../utils/logger";
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats, HealthStatus } from "./base";
import { HttpConnectionPoolManager } from "./pools/http";
import { ConnectionPoolConfig, ConnectionPoolEvent } from "./pools/pool";

/**
 * Enhanced HTTP Server Options with connection pool support
 */
export interface HttpServerOptions extends ListeningOptions {
  connectionPool?: {
    maxConnections?: number;      // 最大连接数限制
    keepAliveTimeout?: number;    // Keep-Alive超时时间 (毫秒)
    headersTimeout?: number;      // 请求头超时时间 (毫秒)
    requestTimeout?: number;      // 请求超时时间 (毫秒)
  };
}

/**
 * HTTP Server with enhanced connection pool management and graceful shutdown
 */
export class HttpServer extends BaseServer<HttpServerOptions> {
  readonly server: Server;
  protected logger = createLogger({ module: 'http', protocol: 'http' });
  private serverId = `http_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  private connectionPool: HttpConnectionPoolManager;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(app: KoattyApplication, options: HttpServerOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'http', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.logger.info('Initializing HTTP server with connection pool', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      maxConnections: options.connectionPool?.maxConnections,
      keepAliveTimeout: options.connectionPool?.keepAliveTimeout,
      headersTimeout: options.connectionPool?.headersTimeout,
      requestTimeout: options.connectionPool?.requestTimeout
    });

    // 初始化连接池
    this.initializeConnectionPool();

    this.server = createServer((req, res) => {
      const startTime = Date.now();
      app.callback()(req, res);
      
      // Record request metrics
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const success = res.statusCode < 400;
        this.recordRequest(success, responseTime);
      });
    });

    // Enhanced connection tracking with connection pool management
    this.server.on('connection', (socket) => {
      // 使用连接池管理连接
      this.connectionPool.addConnection(socket, {
        remoteAddress: socket.remoteAddress,
        userAgent: 'http-client'
      }).catch(error => {
        this.logger.error('Failed to add connection to pool', {}, error);
        socket.destroy();
      });

      // 更新连接活动时间
      socket.on('data', () => {
        this.connectionPool.updateConnectionActivity(socket);
      });
    });

    // Configure connection pool settings
    this.configureConnectionPool();
    
    // 设置连接池事件监听
    this.setupConnectionPoolEventListeners();
    
    // 设置定期清理
    this.setupPeriodicCleanup();
    
    this.logger.debug('HTTP server initialized successfully');
    CreateTerminus(this);
  }

  /**
   * 初始化连接池
   */
  private initializeConnectionPool(): void {
    const poolConfig: ConnectionPoolConfig = this.extractConnectionPoolConfig();
    this.connectionPool = new HttpConnectionPoolManager(poolConfig);
  }

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
   * 设置连接池事件监听
   */
  private setupConnectionPoolEventListeners(): void {
    this.connectionPool.on(ConnectionPoolEvent.POOL_LIMIT_REACHED, (data: any) => {
      this.logger.warn('HTTP connection pool limit reached', {}, data);
    });

    this.connectionPool.on(ConnectionPoolEvent.HEALTH_STATUS_CHANGED, (data: any) => {
      this.logger.info('HTTP connection pool health status changed', {}, data);
    });

    this.connectionPool.on(ConnectionPoolEvent.CONNECTION_ERROR, (data: any) => {
      this.logger.warn('HTTP connection pool error', {}, {
        error: data.error?.message,
        remoteAddress: data.socket?.remoteAddress
      });
    });
  }

  /**
   * 设置定期清理
   */
  private setupPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const cleaned = this.connectionPool.cleanupStaleConnections();
      if (cleaned > 0) {
        this.logger.debug('Cleaned up stale connections', {}, { count: cleaned });
      }
    }, 30000); // 每30秒清理一次
  }

  /**
   * Configure connection pool settings
   */
  private configureConnectionPool(): void {
    const poolConfig = this.options.connectionPool;
    
    if (!poolConfig) {
      this.logger.debug('No connection pool configuration provided, using defaults');
      return;
    }

    // Apply keep-alive timeout
    if (poolConfig.keepAliveTimeout !== undefined) {
      this.server.keepAliveTimeout = poolConfig.keepAliveTimeout;
      this.logger.debug('Set keep-alive timeout', {}, {
        keepAliveTimeout: poolConfig.keepAliveTimeout
      });
    }

    // Apply headers timeout
    if (poolConfig.headersTimeout !== undefined) {
      this.server.headersTimeout = poolConfig.headersTimeout;
      this.logger.debug('Set headers timeout', {}, {
        headersTimeout: poolConfig.headersTimeout
      });
    }

    // Apply request timeout
    if (poolConfig.requestTimeout !== undefined) {
      this.server.requestTimeout = poolConfig.requestTimeout;
      this.logger.debug('Set request timeout', {}, {
        requestTimeout: poolConfig.requestTimeout
      });
    }

    this.logger.info('Connection pool configured successfully', {}, {
      maxConnections: poolConfig.maxConnections || 'unlimited',
      keepAliveTimeout: poolConfig.keepAliveTimeout || this.server.keepAliveTimeout,
      headersTimeout: poolConfig.headersTimeout || this.server.headersTimeout,
      requestTimeout: poolConfig.requestTimeout || this.server.requestTimeout
    });
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof HttpServerOptions)[],
    oldConfig: HttpServerOptions,
    newConfig: HttpServerOptions
  ): ConfigChangeAnalysis {
    // Critical changes that require restart for HTTP server
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    // Check if critical network configuration changed
    if (changedKeys.some(key => criticalKeys.includes(key as keyof ListeningOptions))) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false
      };
    }

    // Check if connection pool configuration changed
    if (this.hasConnectionPoolChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: false,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        restartReason: 'Connection pool configuration can be applied at runtime',
        canApplyRuntime: true
      };
    }

    return {
      requiresRestart: false,
      changedKeys: changedKeys as (keyof ListeningOptions)[],
      canApplyRuntime: true
    };
  }

  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ): void {
    // Update the options
    this.options = { ...this.options, ...(newConfig as Partial<HttpServerOptions>) };
    
    // Reconfigure connection pool if needed
    const httpConfig = newConfig as Partial<HttpServerOptions>;
    if (httpConfig.connectionPool) {
      this.configureConnectionPool();
      
      // 更新连接池配置
      const newPoolConfig = this.extractConnectionPoolConfig();
      this.connectionPool.updateConfig(newPoolConfig);
    }
  }

  protected onRuntimeConfigChange(
    analysis: ConfigChangeAnalysis,
    newConfig: Partial<ListeningOptions>,
    traceId: string
  ): void {
    // Handle HTTP-specific runtime changes
    const httpConfig = newConfig as Partial<HttpServerOptions>;
    if (httpConfig.connectionPool) {
      this.logger.info('Applying connection pool configuration changes', { traceId }, {
        oldConfig: this.options.connectionPool,
        newConfig: httpConfig.connectionPool
      });
      
      // Update connection pool settings
      this.configureConnectionPool();
      
      this.logger.info('Connection pool configuration updated successfully', { traceId });
    }
    
    this.logger.debug('HTTP runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: HttpServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      connectionPool: config.connectionPool,
      ext: config.ext
    };
  }

  /**
   * Check if connection pool configuration has changed
   */
  private hasConnectionPoolChanged(oldConfig: HttpServerOptions, newConfig: HttpServerOptions): boolean {
    const oldPool = oldConfig.connectionPool;
    const newPool = newConfig.connectionPool;
    
    // If both are undefined or null, no change
    if (!oldPool && !newPool) return false;
    
    // If one is defined and the other isn't, there's a change
    if (!oldPool || !newPool) return true;
    
    // Compare individual settings
    return (
      oldPool.maxConnections !== newPool.maxConnections ||
      oldPool.keepAliveTimeout !== newPool.keepAliveTimeout ||
      oldPool.headersTimeout !== newPool.headersTimeout ||
      oldPool.requestTimeout !== newPool.requestTimeout
    );
  }

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new connections', { traceId });
    
    // Close the server to stop accepting new connections
    this.server.close();
    
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
      
      // Use connection pool to close all connections
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
    
    // Stop cleanup interval
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
    
    // Force close server
    this.server.close();
    
    // Force close all connections via connection pool
    this.connectionPool.closeAllConnections(1000);
    
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.connectionPool.getActiveConnectionCount();
  }

  // ============= 实现健康检查和指标收集 =============

  protected async performProtocolHealthChecks(): Promise<Record<string, any>> {
    const checks: Record<string, any> = {};
    
    // HTTP server specific health checks
    const serverListening = this.server.listening;
    const serverAddress = this.server.address();
    
    checks.server = {
      status: serverListening ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      message: serverListening ? 'HTTP server is listening' : 'HTTP server is not listening',
      details: {
        listening: serverListening,
        address: serverAddress
      }
    };

    // Connection pool health check
    const poolHealth = this.connectionPool.getHealth();
    checks.connectionPool = {
      status: poolHealth.status === 'healthy' 
        ? HealthStatus.HEALTHY 
        : poolHealth.status === 'degraded' 
          ? HealthStatus.DEGRADED 
          : HealthStatus.UNHEALTHY,
      message: poolHealth.message,
      details: poolHealth
    };
    
    return checks;
  }

  protected collectProtocolMetrics(): Record<string, any> {
    const poolMetrics = this.connectionPool.getMetrics();
    const poolConfig = this.options.connectionPool;
    
    return {
      protocol: 'http',
      server: {
        listening: this.server.listening,
        address: this.server.address(),
        keepAliveTimeout: this.server.keepAliveTimeout,
        headersTimeout: this.server.headersTimeout,
        requestTimeout: this.server.requestTimeout,
        serverId: this.serverId
      },
      connectionPool: {
        enabled: !!poolConfig,
        ...poolMetrics,
        configuration: poolConfig
      }
    };
  }

  // ============= 原有的 HTTP 功能方法 =============

  /**
   * Start Server
   */
  Start(listenCallback?: () => void): Server {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    listenCallback = listenCallback ? listenCallback : this.listenCallback;
    
    const server = this.server.listen({
      port: this.options.port,
      host: this.options.hostname,
    }, () => {
      this.logger.logServerEvent('started', { traceId }, {
        address: this.server.address(),
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol
      });
      
      // Start monitoring after server is successfully started
      this.startMonitoring();
      
      if (listenCallback) listenCallback();
    }).on("clientError", (err: any, sock: any) => {
      this.logger.error('HTTP client error', { traceId }, err);
      this.recordRequest(false);
      try {
        sock.end('400 Bad Request\r\n\r\n');
      } catch (socketError) {
        this.logger.error('Failed to send error response', { traceId }, socketError);
      }
    }).on("error", (err: Error) => {
      this.logger.logServerEvent('error', { traceId }, err);
    });

    return server;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    const poolMetrics = this.connectionPool.getMetrics();
    return {
      activeConnections: poolMetrics.activeConnections,
      totalConnections: poolMetrics.totalConnections,
      connectionsPerSecond: poolMetrics.connectionsPerSecond,
      averageLatency: poolMetrics.averageLatency,
      errorRate: poolMetrics.errorRate
    };
  }

  /**
   * Get connection pool health
   */
  getConnectionPoolHealth() {
    return this.connectionPool.getHealth();
  }

  /**
   * Get connection pool metrics
   */
  getConnectionPoolMetrics() {
    return this.connectionPool.getMetrics();
  }

  /**
   * Get status
   */
  getStatus(): number {
    return this.status;
  }

  /**
   * Get native server
   */
  getNativeServer(): NativeServer {
    return this.server;
  }
}
