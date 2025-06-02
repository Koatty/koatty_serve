/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 17:46:37
 */
import { createSecureServer, Http2SecureServer, SecureServerOptions } from "http2";
import { readFileSync } from "fs";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats, HealthStatus } from "./base";
import { createLogger, generateTraceId } from "../utils/logger";
import { CreateTerminus } from "../utils/terminus";

/**
 * SSL/TLS Configuration with enhanced security modes for HTTP/2
 */
interface SSL2Config {
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
  allowHTTP1?: boolean;                     // Allow HTTP/1.1 fallback
}

/**
 * Enhanced HTTP2 Server Options
 */
export interface Http2ServerOptions extends ListeningOptions {
  ssl?: SSL2Config;
  http2?: {
    maxHeaderListSize?: number;
    maxSessionMemory?: number;
    settings?: {
      headerTableSize?: number;
      enablePush?: boolean;
      maxConcurrentStreams?: number;
      initialWindowSize?: number;
      maxFrameSize?: number;
      maxHeaderListSize?: number;
    };
  };
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
 * HTTP2 Server with enhanced SSL/TLS configuration management and graceful shutdown
 */
export class Http2Server extends BaseServer<Http2ServerOptions> {
  readonly server: Http2SecureServer;
  protected logger = createLogger({ module: 'http2', protocol: 'http2' });
  private serverId = `http2_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  private connections = new Set<any>();
  private sessions = new Set<any>();
  private activeStreams = new Map<number, any>();
  private connectionStats: ConnectionStats = {
    activeConnections: 0,
    totalConnections: 0,
    connectionsPerSecond: 0,
    averageLatency: 0,
    errorRate: 0
  };
  private http2Stats = {
    activeSessions: 0,
    totalSessions: 0,
    activeStreams: 0,
    totalStreams: 0,
    streamErrors: 0,
    sessionErrors: 0
  };

  constructor(app: KoattyApplication, options: Http2ServerOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'http2', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.logger.info('Initializing HTTP2 server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      sslMode: options.ssl?.mode || 'auto',
      allowHTTP1: options.ssl?.allowHTTP1 !== false
    });

    // Create SSL options with enhanced HTTP/2 configuration
    const http2Options = this.createHTTP2Options();
    
    this.server = createSecureServer(http2Options, (req, res) => {
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
        this.logger.error('HTTP2 connection error', {}, {
          error: error.message,
          remoteAddress: (socket as any).remoteAddress
        });
        this.connectionStats.errorRate += 0.01; // Increment error rate
      });
    });

    // Configure connection pool settings - Note: HTTP2 server doesn't have these properties
    // We'll store the configuration for monitoring purposes only
    if (options.connectionPool) {
      this.logger.info('Connection pool configuration noted for HTTP2', {}, {
        keepAliveTimeout: options.connectionPool.keepAliveTimeout,
        headersTimeout: options.connectionPool.headersTimeout,
        requestTimeout: options.connectionPool.requestTimeout
      });
    }

    // HTTP/2 specific event monitoring
    this.server.on('secureConnection', (tlsSocket) => {
      this.logger.debug('HTTP2 secure connection established', {}, {
        authorized: tlsSocket.authorized,
        protocol: tlsSocket.getProtocol(),
        cipher: tlsSocket.getCipher()?.name,
        alpnProtocol: tlsSocket.alpnProtocol,
        remoteAddress: tlsSocket.remoteAddress
      });
    });

    this.server.on('tlsClientError', (err, tlsSocket) => {
      this.logger.warn('HTTP2 TLS client error', {}, {
        error: err.message,
        remoteAddress: tlsSocket?.remoteAddress
      });
    });

    // HTTP/2 session management
    this.server.on('session', (session) => {
      this.sessions.add(session);
      this.http2Stats.activeSessions++;
      this.http2Stats.totalSessions++;
      
      this.logger.debug('HTTP2 session created', {}, {
        sessionId: (session as any).id || 'unknown',
        type: session.type,
        activeSessions: this.http2Stats.activeSessions
      });

      session.on('error', (error) => {
        this.http2Stats.sessionErrors++;
        this.logger.warn('HTTP2 session error', {}, {
          error: error.message,
          sessionId: (session as any).id || 'unknown',
          totalSessionErrors: this.http2Stats.sessionErrors
        });
      });

      session.on('close', () => {
        this.sessions.delete(session);
        this.http2Stats.activeSessions--;
        this.logger.debug('HTTP2 session closed', {}, {
          sessionId: (session as any).id || 'unknown',
          activeSessions: this.http2Stats.activeSessions
        });
      });
    });

    // HTTP/2 stream monitoring
    this.server.on('stream', (stream, headers) => {
      this.activeStreams.set(stream.id, stream);
      this.http2Stats.activeStreams++;
      this.http2Stats.totalStreams++;
      
      this.logger.debug('HTTP2 stream created', {}, {
        streamId: stream.id,
        method: headers[':method'],
        path: headers[':path'],
        activeStreams: this.http2Stats.activeStreams
      });

      stream.on('error', (error) => {
        this.http2Stats.streamErrors++;
        this.logger.warn('HTTP2 stream error', {}, {
          error: error.message,
          streamId: stream.id,
          totalStreamErrors: this.http2Stats.streamErrors
        });
      });

      stream.on('close', () => {
        this.activeStreams.delete(stream.id);
        this.http2Stats.activeStreams--;
        this.logger.debug('HTTP2 stream closed', {}, {
          streamId: stream.id,
          activeStreams: this.http2Stats.activeStreams
        });
      });
    });
    
    this.logger.debug('HTTP2 server initialized successfully');
    CreateTerminus(this);
  }

  /**
   * Create HTTP/2 server options with enhanced SSL/TLS configuration
   */
  private createHTTP2Options(): SecureServerOptions {
    const sslConfig = this.options.ssl || { mode: 'auto' };
    const extConfig = this.options.ext || {};
    const http2Config = this.options.http2 || {};
    
    let serverOptions: SecureServerOptions = {
      allowHTTP1: sslConfig.allowHTTP1 !== false, // Enable HTTP/1.1 fallback by default
    };

    try {
      // Create SSL configuration
      const sslOptions = this.createSSLOptions(sslConfig, extConfig);
      serverOptions = { ...serverOptions, ...sslOptions };

      // Apply HTTP/2 specific settings via settings object
      if (http2Config.settings) {
        serverOptions.settings = http2Config.settings;
      }

      // Note: HTTP2 server doesn't support maxHeaderListSize and maxSessionMemory at server level
      // These are handled at the session/stream level

      this.logger.info('HTTP2 server options created successfully', {}, {
        allowHTTP1: serverOptions.allowHTTP1,
        sslMode: sslConfig.mode,
        settingsProvided: !!http2Config.settings,
        http2ConfigProvided: !!http2Config
      });

      return serverOptions;
      
    } catch (error) {
      this.logger.error('Failed to create HTTP2 server options', {}, error);
      throw new Error(`HTTP2 server configuration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create SSL options with enhanced security configuration
   */
  private createSSLOptions(sslConfig: SSL2Config, extConfig: any): SecureServerOptions {
    let sslOptions: SecureServerOptions = {};

    try {
      // Determine SSL mode
      const mode = sslConfig.mode || 'auto';
      
      this.logger.info('Creating SSL configuration for HTTP2', {}, {
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
          this.logger.warn('Unknown SSL mode for HTTP2, falling back to auto', {}, { mode });
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

      this.logger.info('SSL configuration for HTTP2 created successfully', {}, {
        mode: mode,
        ciphers: !!sslOptions.ciphers,
        honorCipherOrder: sslOptions.honorCipherOrder,
        secureProtocol: sslOptions.secureProtocol,
        requestCert: sslOptions.requestCert,
        rejectUnauthorized: sslOptions.rejectUnauthorized
      });

      return sslOptions;
      
    } catch (error) {
      this.logger.error('Failed to create SSL configuration for HTTP2', {}, error);
      throw new Error(`HTTP2 SSL configuration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create auto SSL options (detect from available certificates)
   */
  private createAutoSSLOptions(sslConfig: SSL2Config, extConfig: any): SecureServerOptions {
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
  private createManualSSLOptions(sslConfig: SSL2Config, extConfig: any): SecureServerOptions {
    const options: SecureServerOptions = {};

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
  private createMutualTLSOptions(sslConfig: SSL2Config, extConfig: any): SecureServerOptions {
    const options = this.createManualSSLOptions(sslConfig, extConfig);
    
    // Enable client certificate verification
    options.requestCert = true;
    options.rejectUnauthorized = sslConfig.rejectUnauthorized !== false;
    
    // CA is required for mutual TLS
    if (!options.ca) {
      this.logger.warn('Mutual TLS mode recommended with CA certificate for HTTP2');
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
        this.logger.debug(`Using ${type} content directly for HTTP2`);
        return keyOrPath;
      }
      
      // Otherwise, treat as file path
      this.logger.debug(`Loading ${type} from file for HTTP2`, {}, { path: keyOrPath });
      return readFileSync(keyOrPath, 'utf8');
      
    } catch (error) {
      this.logger.error(`Failed to load ${type} for HTTP2`, {}, {
        path: keyOrPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Failed to load ${type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    oldConfig: Http2ServerOptions,
    newConfig: Http2ServerOptions
  ): ConfigChangeAnalysis {
    // Critical changes that require restart for HTTP2 server
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

    // HTTP/2 specific configuration changes
    if (this.hasHTTP2ConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'HTTP/2 protocol configuration changed',
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
    this.options = { ...this.options, ...newConfig } as Http2ServerOptions;
  }

  protected onRuntimeConfigChange(
    analysis: ConfigChangeAnalysis,
    newConfig: Partial<ListeningOptions>,
    traceId: string
  ): void {
    const newHttp2Config = newConfig as Partial<Http2ServerOptions>;
    
    // Note: HTTP2 server doesn't support runtime changes to keepAliveTimeout, headersTimeout, requestTimeout
    // We store the configuration for monitoring and future restart scenarios
    if (newHttp2Config.connectionPool) {
      this.logger.info('HTTP2 connection pool configuration updated (stored for monitoring)', { traceId }, {
        keepAliveTimeout: newHttp2Config.connectionPool.keepAliveTimeout,
        headersTimeout: newHttp2Config.connectionPool.headersTimeout,
        requestTimeout: newHttp2Config.connectionPool.requestTimeout,
        note: 'HTTP2 server does not support runtime timeout changes, will take effect after restart'
      });
    }
    
    this.logger.debug('HTTP2 runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: Http2ServerOptions) {
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
        secureProtocol: config.ssl?.secureProtocol,
        allowHTTP1: config.ssl?.allowHTTP1 !== false
      },
      http2: config.http2,
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
      activeSessions: this.http2Stats.activeSessions,
      activeStreams: this.http2Stats.activeStreams,
      timeout: timeout
    });

    // First, close all active streams gracefully
    try {
      await this.closeAllStreams(Math.min(timeout / 3, 5000));
    } catch (error) {
      this.logger.warn('Error closing streams', { traceId }, error);
    }

    // Then, close all active sessions gracefully
    try {
      await this.closeAllSessions(Math.min(timeout / 3, 5000));
    } catch (error) {
      this.logger.warn('Error closing sessions', { traceId }, error);
    }

    // Finally, wait for TCP connections to complete
    const startTime = Date.now();
    const remainingTimeout = timeout - (Date.now() - startTime);
    
    while (this.connections.size > 0 && (Date.now() - startTime) < remainingTimeout) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= remainingTimeout) {
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
          elapsed: elapsed,
          remainingSessions: this.http2Stats.activeSessions,
          remainingStreams: this.http2Stats.activeStreams
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.debug('Connection completion wait finished', { traceId }, {
      remainingConnections: this.connections.size,
      remainingSessions: this.http2Stats.activeSessions,
      remainingStreams: this.http2Stats.activeStreams
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

  // ============= HTTP2 特有的辅助方法 =============

  /**
   * Enhanced SSL configuration change detection
   */
  private hasSSLConfigChanged(oldConfig: Http2ServerOptions, newConfig: Http2ServerOptions): boolean {
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
    if (oldSSL?.allowHTTP1 !== newSSL?.allowHTTP1) return true;

    // Check ext configuration (backward compatibility)
    if (oldExt?.key !== newExt?.key) return true;
    if (oldExt?.cert !== newExt?.cert) return true;
    if (oldExt?.ca !== newExt?.ca) return true;

    return false;
  }

  /**
   * Check if HTTP/2 specific configuration changed
   */
  private hasHTTP2ConfigChanged(oldConfig: Http2ServerOptions, newConfig: Http2ServerOptions): boolean {
    const oldHttp2 = oldConfig.http2;
    const newHttp2 = newConfig.http2;

    if (!oldHttp2 && !newHttp2) return false;
    if (!oldHttp2 || !newHttp2) return true;

    // Check HTTP/2 specific settings
    if (oldHttp2.maxHeaderListSize !== newHttp2.maxHeaderListSize) return true;
    if (oldHttp2.maxSessionMemory !== newHttp2.maxSessionMemory) return true;

    // Check HTTP/2 settings object
    const oldSettings = oldHttp2.settings;
    const newSettings = newHttp2.settings;
    
    if (!oldSettings && !newSettings) return false;
    if (!oldSettings || !newSettings) return true;

    return (
      oldSettings.headerTableSize !== newSettings.headerTableSize ||
      oldSettings.enablePush !== newSettings.enablePush ||
      oldSettings.maxConcurrentStreams !== newSettings.maxConcurrentStreams ||
      oldSettings.initialWindowSize !== newSettings.initialWindowSize ||
      oldSettings.maxFrameSize !== newSettings.maxFrameSize ||
      oldSettings.maxHeaderListSize !== newSettings.maxHeaderListSize
    );
  }

  /**
   * Check if connection pool configuration changed
   */
  private hasConnectionPoolChanged(oldConfig: Http2ServerOptions, newConfig: Http2ServerOptions): boolean {
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
    
    // HTTP2 server specific health checks
    const serverListening = this.server.listening;
    const serverAddress = this.server.address();
    
    checks.server = {
      status: serverListening ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      message: serverListening ? 'HTTP2 server is listening' : 'HTTP2 server is not listening',
      details: {
        listening: serverListening,
        address: serverAddress,
        allowHTTP1: this.options.ssl?.allowHTTP1 !== false
      }
    };
    
    // Enhanced SSL certificate health check
    checks.ssl = {
      status: HealthStatus.HEALTHY,
      message: 'SSL certificates configured for HTTP2',
      details: {
        mode: this.options.ssl?.mode || 'auto',
        keyConfigured: !!(this.options.ssl?.key || this.options.ext?.key),
        certConfigured: !!(this.options.ssl?.cert || this.options.ext?.cert),
        caConfigured: !!(this.options.ssl?.ca || this.options.ext?.ca),
        mutualTLS: this.options.ssl?.mode === 'mutual_tls',
        allowHTTP1: this.options.ssl?.allowHTTP1 !== false
      }
    };

    // HTTP/2 protocol health check
    const http2Config = this.options.http2;
    checks.http2Protocol = {
      status: HealthStatus.HEALTHY,
      message: 'HTTP/2 protocol configured and monitoring',
      details: {
        maxHeaderListSize: http2Config?.maxHeaderListSize,
        maxSessionMemory: http2Config?.maxSessionMemory,
        settingsConfigured: !!http2Config?.settings,
        activeSessions: this.http2Stats.activeSessions,
        totalSessions: this.http2Stats.totalSessions,
        activeStreams: this.http2Stats.activeStreams,
        totalStreams: this.http2Stats.totalStreams,
        sessionErrors: this.http2Stats.sessionErrors,
        streamErrors: this.http2Stats.streamErrors,
        activeConnections: this.connections.size
      }
    };

    // Connection pool health check
    const connectionPool = this.options.connectionPool;
    if (connectionPool) {
      checks.connectionPool = {
        status: HealthStatus.HEALTHY,
        message: 'Connection pool configured for HTTP2',
        details: {
          configuredKeepAliveTimeout: connectionPool.keepAliveTimeout,
          configuredHeadersTimeout: connectionPool.headersTimeout,
          configuredRequestTimeout: connectionPool.requestTimeout,
          activeConnections: this.connections.size,
          note: 'HTTP2 server timeouts are configured but not accessible at runtime'
        }
      };
    }
    
    return checks;
  }

  protected collectProtocolMetrics(): Record<string, any> {
    const connectionPool = this.options.connectionPool;
    
    return {
      protocol: 'http2',
      server: {
        listening: this.server.listening,
        address: this.server.address(),
        allowHTTP1: this.options.ssl?.allowHTTP1 !== false,
        note: 'HTTP2 server does not expose timeout properties at runtime'
      },
      ssl: {
        mode: this.options.ssl?.mode || 'auto',
        keyConfigured: !!(this.options.ssl?.key || this.options.ext?.key),
        certConfigured: !!(this.options.ssl?.cert || this.options.ext?.cert),
        caConfigured: !!(this.options.ssl?.ca || this.options.ext?.ca),
        mutualTLS: this.options.ssl?.mode === 'mutual_tls',
        ciphers: this.options.ssl?.ciphers,
        secureProtocol: this.options.ssl?.secureProtocol,
        allowHTTP1: this.options.ssl?.allowHTTP1 !== false
      },
      http2: {
        config: this.options.http2 || {},
        sessions: {
          active: this.http2Stats.activeSessions,
          total: this.http2Stats.totalSessions,
          errors: this.http2Stats.sessionErrors
        },
        streams: {
          active: this.http2Stats.activeStreams,
          total: this.http2Stats.totalStreams,
          errors: this.http2Stats.streamErrors
        }
      },
      connectionPool: connectionPool ? {
        ...connectionPool,
        note: 'Configuration values, not runtime values'
      } : {}
    };
  }

  // ============= 原有的 HTTP2 功能方法 =============

  /**
   * Start Server with enhanced HTTP/2 and SSL configuration
   */
  Start(listenCallback?: () => void): Http2SecureServer {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol,
      sslMode: this.options.ssl?.mode || 'auto',
      allowHTTP1: this.options.ssl?.allowHTTP1 !== false
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
        sslMode: this.options.ssl?.mode || 'auto',
        allowHTTP1: this.options.ssl?.allowHTTP1 !== false
      });
      
      // Start monitoring after server is successfully started
      this.startMonitoring();
      
      if (listenCallback) listenCallback();
    }).on("error", (err: Error) => {
      this.logger.logServerEvent('error', { traceId }, err);
    });

    return server;
  }

  /**
   * Get HTTP/2 specific statistics
   */
  getHttp2Stats() {
    return {
      ...this.http2Stats,
      sessionsList: Array.from(this.sessions).map(session => ({
        id: (session as any).id || 'unknown',
        type: session.type,
        state: session.state
      })),
      activeStreamIds: Array.from(this.activeStreams.keys())
    };
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

  /**
   * Close all active HTTP/2 sessions gracefully
   */
  private async closeAllSessions(timeout: number): Promise<void> {
    if (this.sessions.size === 0) return;

    this.logger.debug('Closing all HTTP/2 sessions', {}, {
      activeSessions: this.sessions.size
    });

    const promises: Promise<void>[] = [];
    
    for (const session of this.sessions) {
      promises.push(new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.logger.warn('Session close timeout, forcing close');
          resolve();
        }, timeout);

        session.close(() => {
          clearTimeout(timer);
          resolve();
        });
      }));
    }

    await Promise.all(promises);
    this.logger.debug('All HTTP/2 sessions closed');
  }

  /**
   * Close all active streams gracefully
   */
  private async closeAllStreams(timeout: number): Promise<void> {
    if (this.activeStreams.size === 0) return;

    this.logger.debug('Closing all HTTP/2 streams', {}, {
      activeStreams: this.activeStreams.size
    });

    const promises: Promise<void>[] = [];
    
    for (const [streamId, stream] of this.activeStreams) {
      promises.push(new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.logger.warn('Stream close timeout, forcing close', {}, { streamId });
          resolve();
        }, timeout);

        stream.close(0, () => {
          clearTimeout(timer);
          resolve();
        });
      }));
    }

    await Promise.all(promises);
    this.logger.debug('All HTTP/2 streams closed');
  }
}
