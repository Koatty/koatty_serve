/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2024-11-27 17:45:01
 */
import { createServer, Server, ServerOptions } from "https";
import { readFileSync } from "fs";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats, HealthStatus } from "./base";
import { createLogger, generateTraceId } from "../utils/structured-logger";
import { CreateTerminus } from "../utils/terminus";

/**
 * SSL/TLS Configuration with enhanced security modes
 */
interface SSLConfig {
  mode: 'auto' | 'manual' | 'mutual_tls';  // SSL mode
  key?: string;                             // Private key file path or content
  cert?: string;                            // Certificate file path or content
  ca?: string;                              // CA certificate file path or content
  passphrase?: string;                      // Private key passphrase
  ciphers?: string;                         // Allowed cipher suites
  honorCipherOrder?: boolean;               // Honor cipher order
  secureProtocol?: string;                  // SSL/TLS protocol version
  checkServerIdentity?: boolean;            // Check server identity
  requestCert?: boolean;                    // Request client certificate
  rejectUnauthorized?: boolean;             // Reject unauthorized connections
}

/**
 * Enhanced HTTPS Server Options
 */
export interface HttpsServerOptions extends ListeningOptions {
  ssl?: SSLConfig;
  connectionPool?: {
    maxConnections?: number;
    keepAliveTimeout?: number;
    headersTimeout?: number;
    requestTimeout?: number;
  };
  ext?: {
    key?: string;
    cert?: string;
    ca?: string;
    [key: string]: any;
  };
}

/**
 * HTTPS Server with enhanced SSL/TLS configuration management and graceful shutdown
 */
export class HttpsServer extends BaseServer<HttpsServerOptions> {
  readonly server: Server;
  protected logger = createLogger({ module: 'https', protocol: 'https' });
  private serverId = `https_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  private connections = new Set<any>();
  private connectionStats: ConnectionStats = {
    activeConnections: 0,
    totalConnections: 0,
    connectionsPerSecond: 0,
    averageLatency: 0,
    errorRate: 0
  };

  constructor(app: KoattyApplication, options: HttpsServerOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'https', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.logger.info('Initializing HTTPS server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      sslMode: options.ssl?.mode || 'auto'
    });

    // Create SSL options with enhanced configuration
    const sslOptions = this.createSSLOptions();
    
    this.server = createServer(sslOptions, (req, res) => {
      const startTime = Date.now();
      app.callback()(req, res);
      
      // Record request metrics
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const success = res.statusCode < 400;
        this.recordRequest(success, responseTime);
      });
    });

    // Enhanced connection tracking with error monitoring
    this.server.on('connection', (socket) => {
      this.connections.add(socket);
      this.connectionStats.activeConnections++;
      this.connectionStats.totalConnections++;
      
      socket.on('close', () => {
        this.connections.delete(socket);
        this.connectionStats.activeConnections--;
      });

      socket.on('error', (error: Error) => {
        this.logger.error('HTTPS connection error', {}, {
          error: error.message,
          remoteAddress: (socket as any).remoteAddress
        });
        this.connectionStats.errorRate += 0.01; // Increment error rate
      });
    });

    // Configure connection pool settings
    if (options.connectionPool) {
      if (options.connectionPool.keepAliveTimeout) {
        this.server.keepAliveTimeout = options.connectionPool.keepAliveTimeout;
      }
      if (options.connectionPool.headersTimeout) {
        this.server.headersTimeout = options.connectionPool.headersTimeout;
      }
      if (options.connectionPool.requestTimeout) {
        this.server.requestTimeout = options.connectionPool.requestTimeout;
      }
    }

    // SSL/TLS event monitoring
    this.server.on('secureConnection', (tlsSocket) => {
      this.logger.debug('Secure connection established', {}, {
        authorized: tlsSocket.authorized,
        protocol: tlsSocket.getProtocol(),
        cipher: tlsSocket.getCipher()?.name,
        remoteAddress: tlsSocket.remoteAddress
      });
    });

    this.server.on('tlsClientError', (err, tlsSocket) => {
      this.logger.warn('TLS client error', {}, {
        error: err.message,
        remoteAddress: tlsSocket?.remoteAddress
      });
    });
    
    this.logger.debug('HTTPS server initialized successfully');
    CreateTerminus(this);
  }

  /**
   * Create SSL options with enhanced security configuration
   */
  private createSSLOptions(): ServerOptions {
    const sslConfig = this.options.ssl || { mode: 'auto' };
    const extConfig = this.options.ext || {};
    
    let sslOptions: ServerOptions = {};

    try {
      // Determine SSL mode
      const mode = sslConfig.mode || 'auto';
      
      this.logger.info('Creating SSL configuration', {}, {
        mode: mode,
        keyProvided: !!(sslConfig.key || extConfig.key),
        certProvided: !!(sslConfig.cert || extConfig.cert),
        caProvided: !!(sslConfig.ca || extConfig.ca)
      });

      switch (mode) {
        case 'auto':
          sslOptions = this.createAutoSSLOptions(sslConfig, extConfig);
          break;
          
        case 'manual':
          sslOptions = this.createManualSSLOptions(sslConfig, extConfig);
          break;
          
        case 'mutual_tls':
          sslOptions = this.createMutualTLSOptions(sslConfig, extConfig);
          break;
          
        default:
          this.logger.warn('Unknown SSL mode, falling back to auto', {}, { mode });
          sslOptions = this.createAutoSSLOptions(sslConfig, extConfig);
      }

      // Apply additional SSL settings
      if (sslConfig.ciphers) {
        sslOptions.ciphers = sslConfig.ciphers;
      }
      
      if (sslConfig.honorCipherOrder !== undefined) {
        sslOptions.honorCipherOrder = sslConfig.honorCipherOrder;
      }
      
      if (sslConfig.secureProtocol) {
        sslOptions.secureProtocol = sslConfig.secureProtocol;
      }

      this.logger.info('SSL configuration created successfully', {}, {
        mode: mode,
        ciphers: !!sslOptions.ciphers,
        honorCipherOrder: sslOptions.honorCipherOrder,
        secureProtocol: sslOptions.secureProtocol,
        requestCert: sslOptions.requestCert,
        rejectUnauthorized: sslOptions.rejectUnauthorized
      });

      return sslOptions;
      
    } catch (error) {
      this.logger.error('Failed to create SSL configuration', {}, error);
      throw new Error(`SSL configuration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create auto SSL options (detect from available certificates)
   */
  private createAutoSSLOptions(sslConfig: SSLConfig, extConfig: any): ServerOptions {
    const keyFile = sslConfig.key || extConfig.key;
    const certFile = sslConfig.cert || extConfig.cert;

    if (!keyFile || !certFile) {
      throw new Error('Auto SSL mode requires both key and cert files');
    }

    return {
      key: this.loadCertificate(keyFile, 'private key'),
      cert: this.loadCertificate(certFile, 'certificate'),
      passphrase: sslConfig.passphrase
    };
  }

  /**
   * Create manual SSL options
   */
  private createManualSSLOptions(sslConfig: SSLConfig, extConfig: any): ServerOptions {
    const options: ServerOptions = {};

    // Private key
    const keyFile = sslConfig.key || extConfig.key;
    if (keyFile) {
      options.key = this.loadCertificate(keyFile, 'private key');
    }

    // Certificate
    const certFile = sslConfig.cert || extConfig.cert;
    if (certFile) {
      options.cert = this.loadCertificate(certFile, 'certificate');
    }

    // CA certificate
    const caFile = sslConfig.ca || extConfig.ca;
    if (caFile) {
      options.ca = this.loadCertificate(caFile, 'CA certificate');
    }

    if (sslConfig.passphrase) {
      options.passphrase = sslConfig.passphrase;
    }

    return options;
  }

  /**
   * Create mutual TLS options (client certificate required)
   */
  private createMutualTLSOptions(sslConfig: SSLConfig, extConfig: any): ServerOptions {
    const options = this.createManualSSLOptions(sslConfig, extConfig);
    
    // Enable client certificate verification
    options.requestCert = true;
    options.rejectUnauthorized = sslConfig.rejectUnauthorized !== false;
    
    // CA is required for mutual TLS
    if (!options.ca) {
      this.logger.warn('Mutual TLS mode recommended with CA certificate');
    }

    return options;
  }

  /**
   * Load certificate from file or return as-is if it's content
   */
  private loadCertificate(keyOrPath: string, type: string): string {
    try {
      // If it starts with '-----', treat as certificate content
      if (keyOrPath.startsWith('-----')) {
        this.logger.debug(`Using ${type} content directly`);
        return keyOrPath;
      }
      
      // Otherwise, treat as file path
      this.logger.debug(`Loading ${type} from file`, {}, { path: keyOrPath });
      return readFileSync(keyOrPath, 'utf8');
      
    } catch (error) {
      this.logger.error(`Failed to load ${type}`, {}, {
        path: keyOrPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Failed to load ${type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    oldConfig: HttpsServerOptions,
    newConfig: HttpsServerOptions
  ): ConfigChangeAnalysis {
    // Critical changes that require restart for HTTPS server
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    if (changedKeys.some(key => criticalKeys.includes(key))) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false
      };
    }

    // Enhanced SSL configuration changes detection
    if (this.hasSSLConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'SSL certificate or security configuration changed',
        canApplyRuntime: false
      };
    }

    // Connection pool configuration changes
    if (this.hasConnectionPoolChanged(oldConfig, newConfig)) {
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
    this.options = { ...this.options, ...newConfig } as HttpsServerOptions;
  }

  protected onRuntimeConfigChange(
    analysis: ConfigChangeAnalysis,
    newConfig: Partial<ListeningOptions>,
    traceId: string
  ): void {
    const newHttpsConfig = newConfig as Partial<HttpsServerOptions>;
    
    // Apply connection pool changes at runtime
    if (newHttpsConfig.connectionPool) {
      if (newHttpsConfig.connectionPool.keepAliveTimeout !== undefined) {
        this.server.keepAliveTimeout = newHttpsConfig.connectionPool.keepAliveTimeout;
        this.logger.info('Updated keepAliveTimeout', { traceId }, {
          value: newHttpsConfig.connectionPool.keepAliveTimeout
        });
      }
      
      if (newHttpsConfig.connectionPool.headersTimeout !== undefined) {
        this.server.headersTimeout = newHttpsConfig.connectionPool.headersTimeout;
        this.logger.info('Updated headersTimeout', { traceId }, {
          value: newHttpsConfig.connectionPool.headersTimeout
        });
      }
      
      if (newHttpsConfig.connectionPool.requestTimeout !== undefined) {
        this.server.requestTimeout = newHttpsConfig.connectionPool.requestTimeout;
        this.logger.info('Updated requestTimeout', { traceId }, {
          value: newHttpsConfig.connectionPool.requestTimeout
        });
      }
    }
    
    this.logger.debug('HTTPS runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: HttpsServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      ssl: {
        mode: config.ssl?.mode || 'auto',
        keyFile: config.ssl?.key || config.ext?.key,
        certFile: config.ssl?.cert || config.ext?.cert,
        caFile: config.ssl?.ca || config.ext?.ca,
        ciphers: config.ssl?.ciphers,
        secureProtocol: config.ssl?.secureProtocol
      },
      connectionPool: config.connectionPool
    };
  }

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new connections', { traceId });
    
    // Close the server to stop accepting new connections
    this.server.close();
    
    this.logger.debug('New connection acceptance stopped', { traceId });
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Step 3: Waiting for existing connections to complete', { traceId }, {
      activeConnections: this.connections.size,
      timeout: timeout
    });

    const startTime = Date.now();
    
    while (this.connections.size > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        this.logger.warn('Connection completion timeout reached', { traceId }, {
          remainingConnections: this.connections.size,
          elapsed: elapsed
        });
        break;
      }
      
      // Log progress every 5 seconds
      if (elapsed % 5000 < 100) {
        this.logger.debug('Waiting for connections to complete', { traceId }, {
          remainingConnections: this.connections.size,
          elapsed: elapsed
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('Connection completion wait finished', { traceId }, {
      remainingConnections: this.connections.size
    });
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    const remainingConnections = this.connections.size;
    
    if (remainingConnections > 0) {
      this.logger.info('Step 4: Force closing remaining connections', { traceId }, {
        remainingConnections
      });
      
      // Force close all remaining connections
      for (const connection of this.connections) {
        try {
          connection.destroy();
        } catch (error) {
          this.logger.warn('Failed to destroy connection', { traceId }, error);
        }
      }
      
      this.connections.clear();
      
      this.logger.warn('Forced closure of remaining connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining connections to close', { traceId });
    }
  }

  protected stopMonitoringAndCleanup(traceId: string): void {
    this.logger.info('Step 5: Stopping monitoring and cleanup', { traceId });
    
    // Log final connection statistics
    this.logger.info('Final connection statistics', { traceId }, this.connectionStats);
    
    this.logger.debug('Monitoring stopped and cleanup completed', { traceId });
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force shutdown initiated', { traceId });
    
    // Force close server
    this.server.close();
    
    // Force close all connections
    for (const connection of this.connections) {
      try {
        connection.destroy();
      } catch (error) {
        this.logger.warn('Failed to destroy connection during force shutdown', { traceId }, error);
      }
    }
    this.connections.clear();
    
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.connections.size;
  }

  // ============= HTTPS 特有的辅助方法 =============

  /**
   * Enhanced SSL configuration change detection
   */
  private hasSSLConfigChanged(oldConfig: HttpsServerOptions, newConfig: HttpsServerOptions): boolean {
    const oldSSL = oldConfig.ssl;
    const newSSL = newConfig.ssl;
    const oldExt = oldConfig.ext;
    const newExt = newConfig.ext;

    // Check SSL configuration object
    if (oldSSL?.mode !== newSSL?.mode) return true;
    if (oldSSL?.key !== newSSL?.key) return true;
    if (oldSSL?.cert !== newSSL?.cert) return true;
    if (oldSSL?.ca !== newSSL?.ca) return true;
    if (oldSSL?.ciphers !== newSSL?.ciphers) return true;
    if (oldSSL?.secureProtocol !== newSSL?.secureProtocol) return true;
    if (oldSSL?.honorCipherOrder !== newSSL?.honorCipherOrder) return true;
    if (oldSSL?.requestCert !== newSSL?.requestCert) return true;
    if (oldSSL?.rejectUnauthorized !== newSSL?.rejectUnauthorized) return true;

    // Check ext configuration (backward compatibility)
    if (oldExt?.key !== newExt?.key) return true;
    if (oldExt?.cert !== newExt?.cert) return true;
    if (oldExt?.ca !== newExt?.ca) return true;

    return false;
  }

  /**
   * Check if connection pool configuration changed
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

  // ============= 实现健康检查和指标收集 =============

  protected async performProtocolHealthChecks(): Promise<Record<string, any>> {
    const checks: Record<string, any> = {};
    
    // HTTPS server specific health checks
    const serverListening = this.server.listening;
    const serverAddress = this.server.address();
    
    checks.server = {
      status: serverListening ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      message: serverListening ? 'HTTPS server is listening' : 'HTTPS server is not listening',
      details: {
        listening: serverListening,
        address: serverAddress
      }
    };
    
    // Enhanced SSL certificate health check
    checks.ssl = {
      status: HealthStatus.HEALTHY,
      message: 'SSL certificates configured',
      details: {
        mode: this.options.ssl?.mode || 'auto',
        keyConfigured: !!(this.options.ssl?.key || this.options.ext?.key),
        certConfigured: !!(this.options.ssl?.cert || this.options.ext?.cert),
        caConfigured: !!(this.options.ssl?.ca || this.options.ext?.ca),
        mutualTLS: this.options.ssl?.mode === 'mutual_tls'
      }
    };

    // Connection pool health check
    const connectionPool = this.options.connectionPool;
    if (connectionPool) {
      checks.connectionPool = {
        status: HealthStatus.HEALTHY,
        message: 'Connection pool configured',
        details: {
          keepAliveTimeout: this.server.keepAliveTimeout,
          headersTimeout: this.server.headersTimeout,
          requestTimeout: this.server.requestTimeout,
          activeConnections: this.connections.size
        }
      };
    }
    
    return checks;
  }

  protected collectProtocolMetrics(): Record<string, any> {
    return {
      protocol: 'https',
      server: {
        listening: this.server.listening,
        address: this.server.address(),
        keepAliveTimeout: this.server.keepAliveTimeout,
        headersTimeout: this.server.headersTimeout,
        requestTimeout: this.server.requestTimeout
      },
      ssl: {
        mode: this.options.ssl?.mode || 'auto',
        keyConfigured: !!(this.options.ssl?.key || this.options.ext?.key),
        certConfigured: !!(this.options.ssl?.cert || this.options.ext?.cert),
        caConfigured: !!(this.options.ssl?.ca || this.options.ext?.ca),
        mutualTLS: this.options.ssl?.mode === 'mutual_tls',
        ciphers: this.options.ssl?.ciphers,
        secureProtocol: this.options.ssl?.secureProtocol
      },
      connectionPool: this.options.connectionPool || {}
    };
  }

  // ============= 原有的 HTTPS 功能方法 =============

  /**
   * Start Server with enhanced SSL configuration
   */
  Start(listenCallback?: () => void): Server {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol,
      sslMode: this.options.ssl?.mode || 'auto'
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
        protocol: this.options.protocol,
        sslMode: this.options.ssl?.mode || 'auto'
      });
      
      // Start monitoring after server is successfully started
      this.startMonitoring();
      
      if (listenCallback) listenCallback();
    }).on("clientError", (err: any, sock: any) => {
      this.logger.error('HTTPS client error', { traceId }, err);
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
    return { ...this.connectionStats };
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
