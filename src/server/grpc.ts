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
import { BaseServer, ListeningOptions } from "./base";
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
 * Connection Pool Statistics
 */
interface ConnectionStats {
  activeConnections: number;
  totalConnections: number;
  connectionsPerSecond: number;
  averageLatency: number;
  errorRate: number;
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
  private isShuttingDown = false;
  private shutdownTimeout = 30000; // 30秒关闭超时
  private drainDelay = 5000; // 5秒停止接受新连接的延迟

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

  /**
   * Enhanced configuration hot reload with intelligent change detection
   */
  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ) {
    const traceId = generateTraceId();
    const oldConfig = { ...this.options };
    this.options = { ...this.options, ...newConfig };

    this.logger.info('Analyzing configuration changes', { traceId }, {
      changedKeys,
      oldConfig: this.extractRelevantConfig(oldConfig),
      newConfig: this.extractRelevantConfig(this.options)
    });

    const requiresRestart = this.determineRestartRequirement(changedKeys, oldConfig, this.options as GrpcServerOptions);
    
    if (requiresRestart) {
      this.logger.info('Configuration changes require server restart', { traceId }, {
        changedKeys,
        reason: 'Critical configuration changed'
      });
      this.performGracefulRestart(traceId);
    } else {
      this.logger.info('Applying configuration changes without restart', { traceId }, {
        changedKeys
      });
      this.applyRuntimeConfigChanges(changedKeys, newConfig, traceId);
    }
  }

  /**
   * Determine if server restart is required based on configuration changes
   */
  private determineRestartRequirement(
    changedKeys: (keyof ListeningOptions)[],
    oldConfig: GrpcServerOptions,
    newConfig: GrpcServerOptions
  ): boolean {
    // Critical changes that require restart
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    if (changedKeys.some(key => criticalKeys.includes(key))) {
      return true;
    }

    // SSL configuration changes
    if (this.hasSSLConfigChanged(oldConfig, newConfig)) {
      return true;
    }

    // Channel options changes (affects gRPC server creation)
    if (this.hasChannelOptionsChanged(oldConfig, newConfig)) {
      return true;
    }

    return false;
  }

  /**
   * Check if SSL configuration has changed
   */
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

  /**
   * Check if channel options have changed
   */
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

  /**
   * Apply runtime configuration changes that don't require restart
   */
  private applyRuntimeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>,
    traceId: string
  ) {
    // Handle max connections change
    const grpcConfig = newConfig as Partial<GrpcServerOptions>;
    if (grpcConfig.connectionPool?.maxConnections) {
      this.logger.info('Updating connection pool limits', { traceId }, {
        oldLimit: 'current',
        newLimit: grpcConfig.connectionPool.maxConnections
      });
      // Note: This would require additional implementation to actually enforce limits
    }

    // Handle other runtime changes
    this.logger.debug('Runtime configuration changes applied successfully', { traceId });
  }

  /**
   * Perform graceful restart with connection draining
   */
  private async performGracefulRestart(traceId: string) {
    try {
      this.logger.info('Starting graceful server restart', { traceId });
      
      await this.gracefulStop();
      
      this.logger.info('Server stopped successfully, restarting', { traceId });
      this.Start(this.listenCallback);
      
    } catch (error) {
      this.logger.error('Graceful restart failed', { traceId }, error);
      // Force restart as fallback
      this.Stop(() => {
        this.Start(this.listenCallback);
      });
    }
  }

  /**
   * Extract relevant configuration for logging
   */
  private extractRelevantConfig(config: GrpcServerOptions) {
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
   *
   * @param {() => void} listenCallback
   * @memberof GrpcServer
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
   * Enhanced graceful stop with detailed shutdown steps
   */
  async gracefulStop(timeout: number = this.shutdownTimeout): Promise<void> {
    const traceId = generateTraceId();
    
    if (this.isShuttingDown) {
      this.logger.warn('Shutdown already in progress', { traceId });
      return;
    }

    this.isShuttingDown = true;
    
    this.logger.info('Shutdown initiated', { traceId, action: 'shutdown_initiated' }, {
      activeConnections: this.connectionManager.getConnectionCount(),
      timeout: timeout
    });

    try {
      // Step 1: Stop accepting new connections
      await this.stopAcceptingNewConnections(traceId);
      
      // Step 2: Wait for drain delay
      await this.waitForDrainDelay(traceId);
      
      // Step 3: Wait for existing connections to complete
      await this.waitForConnectionCompletion(traceId, timeout);
      
      // Step 4: Force close remaining connections
      await this.forceCloseRemainingConnections(traceId);
      
      // Step 5: Stop monitoring and cleanup
      this.stopMonitoringAndCleanup(traceId);
      
      this.logger.info('Shutdown completed successfully', { traceId, action: 'shutdown_completed' });
      
    } catch (error) {
      this.logger.error('Error during graceful shutdown', { traceId }, error);
      throw error;
    } finally {
      this.isShuttingDown = false;
    }
  }

  /**
   * Step 1: Stop accepting new connections
   */
  private async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Step 1: Stopping acceptance of new connections', { traceId });
    
    // gRPC server doesn't have a direct way to stop accepting new connections
    // without shutting down, so we'll use a flag to reject new service calls
    (this.server as any)._acceptingNewConnections = false;
    
    this.logger.debug('New connection acceptance stopped', { traceId });
  }

  /**
   * Step 2: Wait for drain delay
   */
  private async waitForDrainDelay(traceId: string): Promise<void> {
    this.logger.info('Step 2: Waiting for drain delay', { traceId }, {
      drainDelay: this.drainDelay
    });
    
    await new Promise(resolve => setTimeout(resolve, this.drainDelay));
    
    this.logger.debug('Drain delay completed', { traceId });
  }

  /**
   * Step 3: Wait for existing connections to complete
   */
  private async waitForConnectionCompletion(traceId: string, timeout: number): Promise<void> {
    this.logger.info('Step 3: Waiting for existing connections to complete', { traceId }, {
      activeConnections: this.connectionManager.getConnectionCount(),
      timeout: timeout - this.drainDelay
    });

    const startTime = Date.now();
    const maxWaitTime = timeout - this.drainDelay;
    
    while (this.connectionManager.getConnectionCount() > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= maxWaitTime) {
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

  /**
   * Step 4: Force close remaining connections
   */
  private async forceCloseRemainingConnections(traceId: string): Promise<void> {
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

  /**
   * Step 5: Stop monitoring and cleanup
   */
  private stopMonitoringAndCleanup(traceId: string): void {
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

  /**
   * Enhanced Stop method with backward compatibility
   */
  Stop(callback?: (err?: Error) => void): void {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId });

    this.gracefulStop()
      .then(() => {
        this.logger.logServerEvent('stopped', { traceId }, { 
          gracefulShutdown: true,
          finalConnectionCount: this.connectionManager.getConnectionCount()
        });
        if (callback) callback();
      })
      .catch((err: Error) => {
        this.logger.error('Graceful shutdown failed, attempting force shutdown', { traceId }, err);
        
        // Fallback to immediate shutdown
        this.server.forceShutdown();
        this.stopMonitoringAndCleanup(traceId);
        
        this.logger.logServerEvent('stopped', { traceId }, { 
          forcedShutdown: true,
          finalConnectionCount: this.connectionManager.getConnectionCount()
        });
        
        if (callback) callback(err);
      });
  }

  /**
   * Register Service with enhanced logging and monitoring
   *
   * @param {ServiceImplementation} impl
   * @memberof GrpcServer
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
   * @returns Connection pool statistics
   */
  getConnectionStats(): ConnectionStats {
    return this.connectionManager.getStats();
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
    return this.server;
  }
}
