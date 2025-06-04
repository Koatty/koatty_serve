/*
 * @Description: HTTPS Server implementation using template method pattern
 * @Usage: HTTPS协议服务器实现
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2024-11-27 23:30:00
 */
import { createServer, Server, ServerOptions } from "https";
import { readFileSync } from "fs";
import { TLSSocket } from "tls";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer, ConfigChangeAnalysis } from "./base";
import { generateTraceId } from "../utils/logger";
import { CreateTerminus } from "../utils/terminus";
import { HttpsConnectionPoolManager } from "../pools/https";
import { ConnectionPoolConfig } from "../config/pool";
import { ConfigHelper, HttpsServerOptions, ListeningOptions, SSL1Config } from "../config/config";

/**
 * HTTPS Server implementation using template method pattern
 * 继承BaseServer，只实现HTTPS特定的逻辑
 */
export class HttpsServer extends BaseServer<HttpsServerOptions> {
  declare readonly server: Server;
  declare protected connectionPool: HttpsConnectionPoolManager;

  constructor(app: KoattyApplication, options: HttpsServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createHttpsConfig(options);
    CreateTerminus(this);
  }

  /**
   * 初始化HTTPS连接池
   */
  protected initializeConnectionPool(): void {
    const poolConfig: ConnectionPoolConfig = this.extractConnectionPoolConfig();
    this.connectionPool = new HttpsConnectionPoolManager(poolConfig);
    
    this.logger.debug('HTTPS connection pool initialized', {}, {
      maxConnections: poolConfig.maxConnections || 'unlimited',
      keepAliveTimeout: poolConfig.keepAliveTimeout,
      headersTimeout: poolConfig.headersTimeout,
      requestTimeout: poolConfig.requestTimeout
    });
  }

  /**
   * 创建HTTPS服务器实例
   */
  protected createProtocolServer(): void {
    const sslOptions = this.createSSLOptions();
    
    (this as any).server = createServer(sslOptions, (req, res) => {
      const startTime = Date.now();
      this.app.callback()(req, res);
      
      // 记录请求指标
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const success = res.statusCode < 400;
        this.recordRequest(success, responseTime);
        
        // 记录HTTPS连接池请求完成
        if ((req as any).socket) {
          this.connectionPool.handleRequestComplete(
            (req as any).socket as TLSSocket, 
            res.getHeaders()['content-length'] as number || 0
          ).catch(error => {
            this.logger.debug('Error handling HTTPS request complete', {}, error);
          });
        }
      });
    });
    
    this.logger.debug('HTTPS server instance created');
  }

  /**
   * 配置HTTPS服务器选项
   */
  protected configureServerOptions(): void {
    this.setupConnectionHandling();
  }

  /**
   * HTTPS特定的额外初始化
   */
  protected performProtocolSpecificInitialization(): void {
    this.logger.info('HTTPS server initialization completed', {}, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol,
      serverId: this.serverId,
      sslMode: this.options.ssl?.mode || 'auto',
      maxConnections: this.options.connectionPool?.maxConnections
    });
  }

  /**
   * 创建SSL选项
   */
  private createSSLOptions(): ServerOptions {
    const sslConfig = this.options.ssl || { mode: 'auto' };
    const extConfig = this.options.ext || {};

    switch (sslConfig.mode) {
      case 'manual':
        return this.createManualSSLOptions(sslConfig, extConfig);
      case 'mutual_tls':
        return this.createMutualTLSOptions(sslConfig, extConfig);
      case 'auto':
      default:
        return this.createAutoSSLOptions(sslConfig, extConfig);
    }
  }

  /**
   * 自动SSL配置
   */
  private createAutoSSLOptions(sslConfig: SSL1Config, extConfig: any): ServerOptions {
    const keyPath = sslConfig.key || extConfig?.key;
    const certPath = sslConfig.cert || extConfig?.cert;
    
    if (!keyPath || !certPath) {
      throw new Error('SSL key and cert are required for HTTPS');
    }
    
    return {
      key: this.loadCertificate(keyPath, 'private key'),
      cert: this.loadCertificate(certPath, 'certificate')
    };
  }

  /**
   * 手动SSL配置
   */
  private createManualSSLOptions(sslConfig: SSL1Config, extConfig: any): ServerOptions {
    const keyPath = sslConfig.key || extConfig?.key;
    const certPath = sslConfig.cert || extConfig?.cert;
    const caPath = sslConfig.ca || extConfig?.ca;
    
    if (!keyPath || !certPath) {
      throw new Error('SSL key and cert are required for manual SSL mode');
    }
    
    const options: ServerOptions = {
      key: this.loadCertificate(keyPath, 'private key'),
      cert: this.loadCertificate(certPath, 'certificate'),
      passphrase: sslConfig.passphrase,
      ciphers: sslConfig.ciphers,
      honorCipherOrder: sslConfig.honorCipherOrder,
      secureProtocol: sslConfig.secureProtocol
    };
    
    if (caPath) {
      options.ca = this.loadCertificate(caPath, 'CA certificate');
    }
    
    return options;
  }

  /**
   * 双向TLS配置
   */
  private createMutualTLSOptions(sslConfig: SSL1Config, extConfig: any): ServerOptions {
    const manualOptions = this.createManualSSLOptions(sslConfig, extConfig);
    
    return {
      ...manualOptions,
      requestCert: sslConfig.requestCert !== false,
      rejectUnauthorized: sslConfig.rejectUnauthorized !== false
    };
  }

  /**
   * 加载证书文件
   */
  private loadCertificate(keyOrPath: string, type: string): string {
    try {
      // 如果是文件路径，读取文件内容
      if (keyOrPath.includes('\n') || keyOrPath.includes('-----')) {
        // 直接是证书内容
        return keyOrPath;
      } else {
        // 是文件路径
        return readFileSync(keyOrPath, 'utf8');
      }
    } catch (error) {
      this.logger.error(`Failed to load ${type}`, {}, { path: keyOrPath, error });
      throw new Error(`Failed to load ${type}: ${(error as Error).message}`);
    }
  }

  /**
   * 设置连接处理
   */
  private setupConnectionHandling(): void {
    // Enhanced connection tracking with connection pool management
    this.server.on('secureConnection', (tlsSocket: TLSSocket) => {
      // 使用连接池管理连接
      this.connectionPool.addHttpsConnection(tlsSocket).catch((error: Error) => {
        this.logger.error('Failed to add HTTPS connection to pool', {}, error);
        tlsSocket.destroy();
      });

      this.logger.debug('Secure connection established', {}, {
        authorized: tlsSocket.authorized,
        protocol: tlsSocket.getProtocol(),
        cipher: tlsSocket.getCipher()?.name,
        remoteAddress: tlsSocket.remoteAddress
      });
    });

    this.server.on('tlsClientError', (err: Error, tlsSocket?: TLSSocket) => {
      this.logger.warn('TLS client error', {}, {
        error: err.message,
        remoteAddress: tlsSocket?.remoteAddress
      });
    });
  }

  /**
   * 记录请求
   */
  private recordRequest(_success: boolean, _responseTime: number): void {
    // 这里可以记录请求统计信息
    // 连接池会自动处理连接级别的统计
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

  // ============= 实现配置管理抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof HttpsServerOptions)[],
    oldConfig: HttpsServerOptions,
    newConfig: HttpsServerOptions
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

    // SSL配置变更
    if (this.hasSSLConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as (keyof ListeningOptions)[],
        restartReason: 'SSL/TLS configuration changed',
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
    newConfig: Partial<HttpsServerOptions>,
    traceId: string
  ): void {
    // 处理HTTPS特定的运行时配置变更
    const httpsConfig = newConfig as Partial<HttpsServerOptions>;
    
    // 更新连接池配置
    if (httpsConfig.connectionPool) {
      this.logger.info('Updating HTTPS connection pool configuration', { traceId }, {
        oldConfig: this.options.connectionPool,
        newConfig: httpsConfig.connectionPool
      });
      
      const newPoolConfig = this.extractConnectionPoolConfig();
      this.connectionPool.updateConfig(newPoolConfig);
    }

    this.logger.debug('HTTPS runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: HttpsServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      sslMode: config.ssl?.mode || 'auto',
      connectionPool: config.connectionPool ? {
        maxConnections: config.connectionPool.maxConnections,
        keepAliveTimeout: config.connectionPool.keepAliveTimeout,
        headersTimeout: config.connectionPool.headersTimeout,
        requestTimeout: config.connectionPool.requestTimeout
      } : null
    };
  }

  /**
   * 检查SSL配置是否变更
   */
  private hasSSLConfigChanged(oldConfig: HttpsServerOptions, newConfig: HttpsServerOptions): boolean {
    const oldSSL = oldConfig.ssl;
    const newSSL = newConfig.ssl;

    if (!oldSSL && !newSSL) return false;
    if (!oldSSL || !newSSL) return true;

    return (
      oldSSL.mode !== newSSL.mode ||
      oldSSL.key !== newSSL.key ||
      oldSSL.cert !== newSSL.cert ||
      oldSSL.ca !== newSSL.ca ||
      oldSSL.ciphers !== newSSL.ciphers ||
      oldSSL.secureProtocol !== newSSL.secureProtocol ||
      oldSSL.honorCipherOrder !== newSSL.honorCipherOrder ||
      oldSSL.requestCert !== newSSL.requestCert ||
      oldSSL.rejectUnauthorized !== newSSL.rejectUnauthorized
    );
  }

  /**
   * 检查连接池配置是否变更
   */
  private hasConnectionPoolChanged(oldConfig: HttpsServerOptions, newConfig: HttpsServerOptions): boolean {
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
    this.logger.info('Step 1: Stopping acceptance of new HTTPS connections', { traceId });
    
    // 停止HTTPS服务器监听
    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    this.logger.debug('New HTTPS connection acceptance stopped', { traceId });
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Step 3: Waiting for existing HTTPS connections to complete', { traceId }, {
      activeConnections: this.getActiveConnectionCount(),
      timeout: timeout
    });

    const startTime = Date.now();
    
    while (this.getActiveConnectionCount() > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        this.logger.warn('HTTPS connection completion timeout reached', { traceId }, {
          remainingConnections: this.getActiveConnectionCount(),
          elapsed: elapsed
        });
        break;
      }
      
      // 每5秒记录一次进度
      if (elapsed % 5000 < 100) {
        this.logger.debug('Waiting for HTTPS connections to complete', { traceId }, {
          remainingConnections: this.getActiveConnectionCount(),
          elapsed: elapsed
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('HTTPS connection completion wait finished', { traceId }, {
      remainingConnections: this.getActiveConnectionCount()
    });
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    const remainingConnections = this.getActiveConnectionCount();
    
    if (remainingConnections > 0) {
      this.logger.info('Step 4: Force closing remaining HTTPS connections', { traceId }, {
        remainingConnections
      });
      
      // 使用连接池强制关闭所有连接
      await this.connectionPool.closeAllConnections(5000);
      
      this.logger.warn('Forced closure of remaining HTTPS connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining HTTPS connections to close', { traceId });
    }
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force HTTPS server shutdown initiated', { traceId });
    
    // 强制关闭HTTPS服务器
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

    this.server.listen(this.options.port, this.options.hostname, () => {
      this.logger.logServerEvent('started', { traceId }, {
        address: `${this.options.hostname}:${this.options.port}`,
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol,
        connectionPoolEnabled: !!this.connectionPool,
        serverId: this.serverId,
        sslMode: this.options.ssl?.mode || 'auto'
      });
      
      // 启动连接池监控
      this.startConnectionPoolMonitoring();
      
      if (listenCallback) {
        listenCallback();
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

  // ============= HTTPS特定的方法 =============

  /**
   * 启动连接池监控
   */
  private startConnectionPoolMonitoring(): void {
    const monitoringInterval = setInterval(() => {
      const stats = this.getConnectionStats();
      this.logger.debug('HTTPS connection pool statistics', {}, stats);
    }, 30000); // 每30秒

    // 存储间隔以供清理
    (this.server as any)._monitoringInterval = monitoringInterval;
  }

  /**
   * 获取安全统计信息
   */
  getSecurityMetrics() {
    return {
      sslMode: this.options.ssl?.mode || 'auto',
      ciphers: this.options.ssl?.ciphers,
      secureProtocol: this.options.ssl?.secureProtocol,
      mutualTLS: this.options.ssl?.mode === 'mutual_tls'
    };
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
    this.logger.info('Destroying HTTPS server', { traceId });

    try {
      await this.gracefulShutdown();
      this.logger.info('HTTPS server destroyed successfully', { traceId });
    } catch (error) {
      this.logger.error('Error destroying HTTPS server', { traceId }, error);
      throw error;
    }
  }
} 