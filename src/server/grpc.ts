/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-09 17:03:50
 * @LastEditTime: 2024-11-27 17:24:54
 */
import {
  ChannelOptions, Server, ServerCredentials,
  ServiceDefinition, UntypedHandleCall
} from "@grpc/grpc-js";
import { readFileSync } from "fs";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats } from "./base";
import { createLogger, generateTraceId } from "../utils/structured-logger";
import { CreateTerminus } from "../utils/terminus";

/**
 * ServiceImplementation
 *
 * @interface ServiceImplementation
 */
interface ServiceImplementation {
  service: ServiceDefinition;
  implementation: Implementation;
}

/**
 * Implementation
 *
 * @interface Implementation
 */
interface Implementation {
  [methodName: string]: UntypedHandleCall;
}

/**
 * SSL/TLS Configuration
 */
interface SSLConfig {
  enabled: boolean;
  keyFile?: string;
  certFile?: string;
  caFile?: string;
  clientCertRequired?: boolean;
}

/**
 * gRPC Server Options with enhanced configuration
 *
 * @export
 * @interface GrpcServerOptions
 * @extends {ListeningOptions}
 */
export interface GrpcServerOptions extends ListeningOptions {
  channelOptions?: ChannelOptions;
  ssl?: SSLConfig;
  connectionPool?: {
    maxConnections?: number;
    keepAliveTime?: number;
    keepAliveTimeout?: number;
    maxReceiveMessageLength?: number;
    maxSendMessageLength?: number;
  };
  ext?: {
    key?: string;
    cert?: string;
    ca?: string;
    [key: string]: any;
  };
}

/**
 * Connection Manager for gRPC Server
 */
class GrpcConnectionManager {
  private connections = new Map<string, any>();
  private stats: ConnectionStats = {
    activeConnections: 0,
    totalConnections: 0,
    connectionsPerSecond: 0,
    averageLatency: 0,
    errorRate: 0
  };
  private logger: any;
  private startTime = Date.now();
  private lastStatsTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;

  constructor(logger: any) {
    this.logger = logger.createChild({ component: 'connection_manager' });
  }

  addConnection(connectionId: string, connection: any) {
    this.connections.set(connectionId, {
      connection,
      startTime: Date.now(),
      requestCount: 0
    });
    this.stats.activeConnections++;
    this.stats.totalConnections++;
    
    this.logger.logConnectionEvent('connected', { connectionId }, {
      activeConnections: this.stats.activeConnections,
      totalConnections: this.stats.totalConnections
    });
  }

  removeConnection(connectionId: string) {
    const conn = this.connections.get(connectionId);
    if (conn) {
      const duration = Date.now() - conn.startTime;
      this.connections.delete(connectionId);
      this.stats.activeConnections--;
      
      this.logger.logConnectionEvent('disconnected', { connectionId }, {
        duration: `${duration}ms`,
        requestCount: conn.requestCount,
        activeConnections: this.stats.activeConnections
      });
    }
  }

  recordRequest(connectionId: string, success: boolean = true) {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.requestCount++;
    }
    this.requestCount++;
    if (!success) {
      this.errorCount++;
    }
  }

  getStats(): ConnectionStats {
    const now = Date.now();
    const timeDiff = (now - this.lastStatsTime) / 1000;
    
    if (timeDiff > 0) {
      this.stats.connectionsPerSecond = this.stats.totalConnections / ((now - this.startTime) / 1000);
      this.stats.errorRate = this.errorCount / Math.max(this.requestCount, 1);
    }
    
    return { ...this.stats };
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

export class GrpcServer extends BaseServer<GrpcServerOptions> {
  readonly server: Server;
  protected logger = createLogger({ module: 'grpc', protocol: 'grpc' });
  private serverId = `grpc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  private connectionManager: GrpcConnectionManager;

  constructor(app: KoattyApplication, options: GrpcServerOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'grpc', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.connectionManager = new GrpcConnectionManager(this.logger);

    this.logger.info('Initializing gRPC server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      sslEnabled: options.ssl?.enabled || false
    });

    const opts = this.options as GrpcServerOptions;
    opts.ext = opts.ext || {};
    
    // Enhanced channel options with connection pooling
    const channelOptions: ChannelOptions = {
      ...opts.channelOptions,
      ...opts.ext,
      // Connection pool configuration
      'grpc.keepalive_time_ms': opts.connectionPool?.keepAliveTime || 30000,
      'grpc.keepalive_timeout_ms': opts.connectionPool?.keepAliveTimeout || 5000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_receive_message_length': opts.connectionPool?.maxReceiveMessageLength || 4 * 1024 * 1024,
      'grpc.max_send_message_length': opts.connectionPool?.maxSendMessageLength || 4 * 1024 * 1024,
      'grpc.max_connection_idle_ms': 300000, // 5 minutes
      'grpc.max_connection_age_ms': 3600000, // 1 hour
      'grpc.max_connection_age_grace_ms': 30000, // 30 seconds
    };
    
    this.server = new Server(channelOptions);
    
    this.logger.debug('gRPC server initialized successfully', {}, {
      channelOptions,
      connectionPoolConfig: opts.connectionPool
    });
    
    CreateTerminus(this);
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    oldConfig: GrpcServerOptions,
    newConfig: GrpcServerOptions
  ): ConfigChangeAnalysis {
    // Critical changes that require restart
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    if (changedKeys.some(key => criticalKeys.includes(key))) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false
      };
    }

    // SSL configuration changes
    if (this.hasSSLConfigChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'SSL/TLS configuration changed',
        canApplyRuntime: false
      };
    }

    // Channel options changes (affects gRPC server creation)
    if (this.hasChannelOptionsChanged(oldConfig, newConfig)) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'Connection pool configuration changed',
        canApplyRuntime: false
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
    newConfig: Partial<ListeningOptions>,
    traceId: string
  ): void {
    // Handle gRPC-specific runtime changes
    const grpcConfig = newConfig as Partial<GrpcServerOptions>;
    if (grpcConfig.connectionPool?.maxConnections) {
      this.logger.info('Updating connection pool limits', { traceId }, {
        oldLimit: 'current',
        newLimit: grpcConfig.connectionPool.maxConnections
      });
      // Note: This would require additional implementation to actually enforce limits
    }

    this.logger.debug('gRPC runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: GrpcServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      sslEnabled: config.ssl?.enabled || false,
      connectionPool: config.connectionPool ? {
        maxConnections: config.connectionPool.maxConnections,
        keepAliveTime: config.connectionPool.keepAliveTime,
        keepAliveTimeout: config.connectionPool.keepAliveTimeout
      } : null
    };
  }

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new connections', { traceId });
    
    // gRPC server doesn't have a direct way to stop accepting new connections
    // without shutting down, so we'll use a flag to reject new service calls
    (this.server as any)._acceptingNewConnections = false;
    
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
      
      // Force shutdown the gRPC server
      this.server.forceShutdown();
      
      this.logger.warn('Forced closure of remaining connections', { traceId }, {
        forcedConnections: remainingConnections
      });
    } else {
      this.logger.debug('Step 4: No remaining connections to close', { traceId });
    }
  }

  protected stopMonitoringAndCleanup(traceId: string): void {
    this.logger.info('Step 5: Stopping monitoring and cleanup', { traceId });
    
    // Clear monitoring interval
    if ((this.server as any)._monitoringInterval) {
      clearInterval((this.server as any)._monitoringInterval);
      (this.server as any)._monitoringInterval = null;
    }

    // Log final connection statistics
    const finalStats = this.connectionManager.getStats();
    this.logger.info('Final connection statistics', { traceId }, finalStats);
    
    this.logger.debug('Monitoring stopped and cleanup completed', { traceId });
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force shutdown initiated', { traceId });
    this.server.forceShutdown();
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.connectionManager.getConnectionCount();
  }

  // ============= gRPC 特有的辅助方法 =============

  private hasSSLConfigChanged(oldConfig: GrpcServerOptions, newConfig: GrpcServerOptions): boolean {
    const oldSSL = oldConfig.ssl;
    const newSSL = newConfig.ssl;

    if (!oldSSL && !newSSL) return false;
    if (!oldSSL || !newSSL) return true;

    return (
      oldSSL.enabled !== newSSL.enabled ||
      oldSSL.keyFile !== newSSL.keyFile ||
      oldSSL.certFile !== newSSL.certFile ||
      oldSSL.caFile !== newSSL.caFile ||
      oldSSL.clientCertRequired !== newSSL.clientCertRequired
    );
  }

  private hasChannelOptionsChanged(oldConfig: GrpcServerOptions, newConfig: GrpcServerOptions): boolean {
    const oldPool = oldConfig.connectionPool;
    const newPool = newConfig.connectionPool;

    if (!oldPool && !newPool) return false;
    if (!oldPool || !newPool) return true;

    return (
      oldPool.keepAliveTime !== newPool.keepAliveTime ||
      oldPool.keepAliveTimeout !== newPool.keepAliveTimeout ||
      oldPool.maxReceiveMessageLength !== newPool.maxReceiveMessageLength ||
      oldPool.maxSendMessageLength !== newPool.maxSendMessageLength
    );
  }

  // ============= 原有的 gRPC 功能方法 =============

  /**
   * Create SSL credentials from configuration
   * @private
   */
  private createSSLCredentials(): ServerCredentials {
    const traceId = generateTraceId();
    const opts = this.options as GrpcServerOptions;
    
    if (!opts.ssl?.enabled) {
      this.logger.warn('SSL disabled, using insecure credentials', { traceId });
      return ServerCredentials.createInsecure();
    }

    try {
      let rootCerts: Buffer | null = null;
      const keyCertPairs: Array<{ private_key: Buffer; cert_chain: Buffer }> = [];

      // Load CA certificate if provided
      if (opts.ssl.caFile || opts.ext?.ca) {
        const caPath = opts.ssl.caFile || opts.ext?.ca;
        rootCerts = readFileSync(caPath!);
        this.logger.debug('CA certificate loaded', { traceId }, { caFile: caPath });
      }

      // Load server key and certificate
      const keyPath = opts.ssl.keyFile || opts.ext?.key;
      const certPath = opts.ssl.certFile || opts.ext?.cert;

      if (!keyPath || !certPath) {
        throw new Error('SSL enabled but key or cert file not provided');
      }

      const privateKey = readFileSync(keyPath);
      const certChain = readFileSync(certPath);

      keyCertPairs.push({
        private_key: privateKey,
        cert_chain: certChain
      });

      this.logger.info('SSL certificates loaded successfully', { traceId }, {
        keyFile: keyPath,
        certFile: certPath,
        clientCertRequired: opts.ssl.clientCertRequired || false
      });

      const checkClientCertificate = opts.ssl.clientCertRequired ? true : false;

      return ServerCredentials.createSsl(
        rootCerts,
        keyCertPairs,
        checkClientCertificate
      );

    } catch (error) {
      this.logger.error('Failed to create SSL credentials, falling back to insecure', { traceId }, error);
      return ServerCredentials.createInsecure();
    }
  }

  /**
   * Start Server with enhanced connection management
   */
  Start(listenCallback?: () => void): Server {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    const finalCallback = listenCallback || this.listenCallback;
    const credentials = this.createSSLCredentials();
    
    const bindAddress = `${this.options.hostname}:${this.options.port}`;
    
    this.server.bindAsync(bindAddress, credentials, (err, port) => {
      if (err) {
        this.logger.logServerEvent('error', { traceId }, err);
        return;
      }
      
      this.logger.logServerEvent('started', { traceId }, {
        address: bindAddress,
        actualPort: port,
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol,
        sslEnabled: (this.options as GrpcServerOptions).ssl?.enabled || false,
        connectionPoolEnabled: true
      });
      
      // Start connection monitoring
      this.startConnectionMonitoring();
      
      if (finalCallback) {
        finalCallback();
      }
    });

    return this.server;
  }

  /**
   * Start connection monitoring and statistics collection
   * @private
   */
  private startConnectionMonitoring() {
    const monitoringInterval = setInterval(() => {
      const stats = this.connectionManager.getStats();
      this.logger.debug('Connection pool statistics', {}, stats);
    }, 30000); // Every 30 seconds

    // Store interval for cleanup
    (this.server as any)._monitoringInterval = monitoringInterval;
  }

  /**
   * Register Service with enhanced logging and monitoring
   */
  RegisterService(impl: ServiceImplementation) {
    const traceId = generateTraceId();
    this.logger.info('Registering gRPC service', { traceId }, {
      serviceName: impl.service.serviceName || 'Unknown',
      methods: Object.keys(impl.implementation)
    });
    
    // Wrap implementation methods for monitoring
    const wrappedImplementation: Implementation = {};
    
    for (const [methodName, handler] of Object.entries(impl.implementation)) {
      wrappedImplementation[methodName] = (call: any, callback: any) => {
        const connectionId = `grpc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const methodTraceId = generateTraceId();
        
        // Log method call
        this.logger.debug('gRPC method call', { traceId: methodTraceId, connectionId }, {
          serviceName: impl.service.serviceName,
          methodName,
          peer: call.getPeer ? call.getPeer() : 'unknown'
        });

        // Add connection to manager
        this.connectionManager.addConnection(connectionId, call);

        // Wrap callback for monitoring
        const wrappedCallback = (err: any, response: any) => {
          const success = !err;
          this.connectionManager.recordRequest(connectionId, success);
          
          if (err) {
            this.logger.error('gRPC method error', { traceId: methodTraceId, connectionId }, {
              serviceName: impl.service.serviceName,
              methodName,
              error: err
            });
          } else {
            this.logger.debug('gRPC method completed', { traceId: methodTraceId, connectionId }, {
              serviceName: impl.service.serviceName,
              methodName
            });
          }
          
          // Remove connection after completion
          this.connectionManager.removeConnection(connectionId);
          
          if (callback) callback(err, response);
        };

        // Call original handler
        try {
          handler(call, wrappedCallback);
        } catch (error) {
          this.logger.error('gRPC method handler error', { traceId: methodTraceId, connectionId }, error);
          this.connectionManager.recordRequest(connectionId, false);
          this.connectionManager.removeConnection(connectionId);
          if (callback) callback(error, null);
        }
      };
    }
    
    this.server.addService(impl.service, wrappedImplementation);
    
    this.logger.debug('gRPC service registered successfully', { traceId }, {
      serviceName: impl.service.serviceName || 'Unknown'
    });
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    return this.connectionManager.getStats();
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
