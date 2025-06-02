/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 17:47:17
 */
import { createServer, Server } from "http";
import { KoattyApplication, NativeServer } from "koatty_core";
import { createLogger, generateTraceId } from "../utils/structured-logger";
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ListeningOptions, ConfigChangeAnalysis, ConnectionStats, HealthStatus } from "./base";

/**
 * HTTP Server with enhanced configuration management and graceful shutdown
 */
export class HttpServer extends BaseServer<ListeningOptions> {
  readonly server: Server;
  protected logger = createLogger({ module: 'http', protocol: 'http' });
  private serverId = `http_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  private connections = new Set<any>();
  private connectionStats: ConnectionStats = {
    activeConnections: 0,
    totalConnections: 0,
    connectionsPerSecond: 0,
    averageLatency: 0,
    errorRate: 0
  };

  constructor(app: KoattyApplication, options: ListeningOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'http', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.logger.info('Initializing HTTP server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol
    });

    this.server = createServer((req, res) => {
      app.callback()(req, res);
    });

    // Track connections for graceful shutdown
    this.server.on('connection', (socket) => {
      this.connections.add(socket);
      this.connectionStats.activeConnections++;
      this.connectionStats.totalConnections++;
      
      socket.on('close', () => {
        this.connections.delete(socket);
        this.connectionStats.activeConnections--;
      });
    });
    
    this.logger.debug('HTTP server initialized successfully');
    CreateTerminus(this);
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected analyzeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    _oldConfig: ListeningOptions,
    _newConfig: ListeningOptions
  ): ConfigChangeAnalysis {
    // Critical changes that require restart for HTTP server
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    
    if (changedKeys.some(key => criticalKeys.includes(key))) {
      return {
        requiresRestart: true,
        changedKeys,
        restartReason: 'Critical network configuration changed',
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
    // Handle HTTP-specific runtime changes
    this.logger.debug('HTTP runtime configuration changes applied', { traceId });
  }

  protected extractRelevantConfig(config: ListeningOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      ext: config.ext
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
    
    return checks;
  }

  protected collectProtocolMetrics(): Record<string, any> {
    return {
      protocol: 'http',
      server: {
        listening: this.server.listening,
        address: this.server.address(),
        keepAliveTimeout: this.server.keepAliveTimeout,
        headersTimeout: this.server.headersTimeout,
        requestTimeout: this.server.requestTimeout
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
