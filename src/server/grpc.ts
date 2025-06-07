/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-09 17:03:50
 * @LastEditTime: 2024-11-27 21:15:00
 */
import {
  ChannelOptions, Server, ServerCredentials,
  ServiceDefinition, UntypedHandleCall
} from "@grpc/grpc-js";
import { readFileSync } from "fs";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer, ConfigChangeAnalysis, ConnectionStats } from "./base";
import { generateTraceId } from "../utils/logger";
import { CreateTerminus } from "../utils/terminus";
import { HealthStatus } from "./base";
import { ConnectionPoolConfig } from "../config/pool";
import { ConfigHelper, GrpcServerOptions, ListeningOptions } from "../config/config";
import { GrpcConnectionPoolManager } from "../pools/factory";

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

export class GrpcServer extends BaseServer<GrpcServerOptions> {
  declare readonly server: Server;
  declare protected connectionPool: GrpcConnectionPoolManager;
  options: GrpcServerOptions;

  constructor(app: KoattyApplication, options: GrpcServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createGrpcConfig(app, options);
    CreateTerminus(app, this);
  }


  /**
   * 初始化gRPC连接池
   */
  protected initializeConnectionPool(): void {
    const poolConfig: ConnectionPoolConfig = this.extractConnectionPoolConfig();
    this.connectionPool = new GrpcConnectionPoolManager(poolConfig);
  }

  /**
   * 创建gRPC服务器实例
   */
  protected createProtocolServer(): void {
    const opts = this.options as GrpcServerOptions;
    opts.ext = opts.ext || {};
    
    // Enhanced channel options with connection pooling
    const channelOptions: ChannelOptions = {
      ...opts.channelOptions,
      ...opts.ext,
      // Connection pool configuration
      'grpc.keepalive_time_ms': opts.connectionPool?.protocolSpecific?.keepAliveTime || 30000,
      'grpc.keepalive_timeout_ms': opts.connectionPool?.keepAliveTimeout || 5000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_receive_message_length': opts.connectionPool?.protocolSpecific?.maxReceiveMessageLength || 4 * 1024 * 1024,
      'grpc.max_send_message_length': opts.connectionPool?.protocolSpecific?.maxSendMessageLength || 4 * 1024 * 1024,
      'grpc.max_connection_idle_ms': 300000, // 5 minutes
      'grpc.max_connection_age_ms': 3600000, // 1 hour
      'grpc.max_connection_age_grace_ms': 30000, // 30 seconds
    };
    
    (this as any).server = new Server(channelOptions);
  }

  /**
   * 配置gRPC服务器选项
   */
  protected configureServerOptions(): void {
    // gRPC服务器配置在createProtocolServer中完成
  }

  /**
   * gRPC特定的额外初始化
   */
  protected performProtocolSpecificInitialization(): void {
    this.logger.info('gRPC server initialization completed', {}, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol,
      serverId: this.serverId,
      sslEnabled: this.options.ssl?.enabled || false,
      maxConnections: this.options.connectionPool?.maxConnections
    });
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
    changedKeys: (keyof GrpcServerOptions)[],
    newConfig: Partial<GrpcServerOptions>
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
        keepAliveTime: config.connectionPool.protocolSpecific?.keepAliveTime,
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
    this.server.forceShutdown();
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.connectionPool.getActiveConnectionCount();
  }

  // ============= 实现健康检查和指标收集 =============

  protected async performProtocolHealthChecks(): Promise<Record<string, any>> {
    const checks: Record<string, any> = {};
    
    // gRPC server specific health checks
    checks.server = {
      status: HealthStatus.HEALTHY,
      message: 'gRPC server is running',
      details: {
        serverId: this.serverId,
        protocol: this.options.protocol
      }
    };

    // Connection pool health check
    const poolHealth = this.connectionPool.getHealth();
    checks.connectionPool = {
      status: poolHealth.status === 'healthy' 
        ? HealthStatus.HEALTHY 
        : poolHealth.status === 'degraded' 
          ? HealthStatus.DEGRADED 
          : HealthStatus.OVERLOADED,
      message: poolHealth.message,
      details: poolHealth
    };

    // SSL configuration health check
    if (this.options.ssl?.enabled) {
      checks.ssl = {
        status: HealthStatus.HEALTHY,
        message: 'SSL/TLS is enabled',
        details: {
          keyFile: !!this.options.ssl.keyFile,
          certFile: !!this.options.ssl.certFile,
          caFile: !!this.options.ssl.caFile,
          clientCertRequired: this.options.ssl.clientCertRequired
        }
      };
    }

    // Channel options health check
    const channelOptions = this.options.channelOptions;
    if (channelOptions) {
      checks.channelOptions = {
        status: HealthStatus.HEALTHY,
        message: 'Channel options configured',
        details: {
          keepAliveTime: channelOptions['grpc.keepalive_time_ms'],
          keepAliveTimeout: channelOptions['grpc.keepalive_timeout_ms'],
          maxReceiveMessageLength: channelOptions['grpc.max_receive_message_length'],
          maxSendMessageLength: channelOptions['grpc.max_send_message_length']
        }
      };
    }
    
    return checks;
  }

  protected collectProtocolMetrics(): Record<string, any> {
    const poolMetrics = this.connectionPool.getMetrics();
    const poolConfig = this.options.connectionPool;
    
    return {
      protocol: 'grpc',
      server: {
        serverId: this.serverId,
        ssl: this.options.ssl?.enabled || false
      },
      connectionPool: {
        enabled: !!poolConfig,
        ...poolMetrics,
        configuration: poolConfig
      },
      channelOptions: this.options.channelOptions || {}
    };
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
      oldPool.protocolSpecific?.keepAliveTime !== newPool.protocolSpecific?.keepAliveTime ||
      oldPool.protocolSpecific?.maxReceiveMessageLength !== newPool.protocolSpecific?.maxReceiveMessageLength ||
      oldPool.protocolSpecific?.maxSendMessageLength !== newPool.protocolSpecific?.maxSendMessageLength
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
      const stats = this.connectionPool.getMetrics();
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

        // Add connection to manager using the new API
        const peer = call.getPeer ? call.getPeer() : 'unknown';
        const callMetadata = {
          connectionId,
          serviceName: impl.service.serviceName,
          methodName,
          peer
        };
        
        this.connectionPool.addGrpcConnection(peer, callMetadata).catch((error: any) => {
          this.logger.error('Failed to add gRPC connection to pool', {}, error);
        });

        // Wrap callback for monitoring
        const wrappedCallback = (err: any, response: any) => {
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
          
          // Note: Connection cleanup is handled automatically by the pool
          
          if (callback) callback(err, response);
        };

        // Call original handler
        try {
          handler(call, wrappedCallback);
        } catch (error) {
          this.logger.error('gRPC method handler error', { traceId: methodTraceId, connectionId }, error);
          
          // Note: Connection error handling is managed by the pool
          
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

  // ============= gRPC特定的私有方法 =============

  /**
   * 提取连接池配置
   */
  private extractConnectionPoolConfig(): ConnectionPoolConfig {
    const options = this.options.connectionPool;
    return {
      maxConnections: options?.maxConnections,
      connectionTimeout: 30000, // 30秒连接超时
      protocolSpecific: {
        keepAliveTime: options?.protocolSpecific?.keepAliveTime,
        maxReceiveMessageLength: options?.protocolSpecific?.maxReceiveMessageLength,
        maxSendMessageLength: options?.protocolSpecific?.maxSendMessageLength
      }
    };
  }
}
