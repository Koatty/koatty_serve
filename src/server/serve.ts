/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-12-03 16:23:54
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import fs from "fs";
import { KoattyApplication, KoattyServer, NativeServer } from "koatty_core";
import { createLogger, generateTraceId } from "../utils/logger";
import { validateConfig } from "../utils/validator";
import { GrpcServer } from "./grpc";
import { HttpServer as KoattyHttpServer } from "./http";
import { Http2Server } from "./http2";
import { Http3Server } from "./http3";
import { HttpsServer as KoattyHttpsServer } from "./https";
import { WsServer } from "./ws";
import { CreateTerminus } from "../utils/terminus";
import { KoattyProtocol, ListeningOptions } from "../config/config";

/**
 * Internal interface for single server instance
 */
interface SingleServerOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol; // 单个协议
  trace?: boolean;
  ext?: any;
}

/**
 * Single protocol server
 */
export class SingleProtocolServer implements KoattyServer {
  private app: KoattyApplication;
  private serverInstance: KoattyServer | null = null; // Actual server instance
  server: NativeServer | null = null; // Native server instance
  private logger = createLogger({ module: 'singleprotocol' });

  readonly protocol: string = 'http';
  readonly options: ListeningOptions;
  status: number = 0; // Server status
  listenCallback?: () => void;

  constructor(app: KoattyApplication, opt: ListeningOptions) {
    this.app = app;
    this.options = {
      hostname: '127.0.0.1',
      port: 3000,
      protocol: 'http',
      ...opt
    };

    this.status = 0;

    this.logger.info('Single protocol server initialized', {}, {
      protocol: this.options.protocol,
      hostname: this.options.hostname,
      port: this.options.port
    });

    CreateTerminus(app, this);
  }

  /**
   * Start server
   */
  Start(listenCallback?: () => void): any {
    const traceId = generateTraceId();
    this.listenCallback = listenCallback;
    
    try {
      this.logger.info('Server starting', { traceId }, {
        protocol: this.options.protocol,
        hostname: this.options.hostname,
        port: this.options.port
      });

      // Create and start server
      this.createServer(traceId);
      
      // Update status to indicate server is running
      this.status = this.serverInstance ? 200 : 500;
      
      this.logger.info('Server started', { traceId }, {
        protocol: this.options.protocol,
        port: this.options.port
      });

      if (this.listenCallback) {
        this.listenCallback();
      }
      
      return this;
    } catch (error) {
      this.logger.error('Server start error', { traceId }, error);
      throw error;
    }
  }

  /**
   * Stop server
   */
  Stop(callback?: () => void): void {
    const traceId = generateTraceId();
    this.logger.info('Server stopping', { traceId }, {
      protocol: this.options.protocol,
      port: this.options.port
    });

    if (this.serverInstance && typeof this.serverInstance.Stop === 'function') {
      this.serverInstance.Stop(() => {
        this.serverInstance = null;
        this.server = null;
        this.status = 0;
        this.logger.info('Server stopped', { traceId });
        if (callback) callback();
      });
    } else {
      this.logger.warn('Server has no Stop method', { traceId });
      this.serverInstance = null;
      this.server = null;
      this.status = 0;
      if (callback) callback();
    }
  }

  /**
   * Register Service for gRPC server
   */
  RegisterService(impl: (...args: any[]) => any) {
    if (this.serverInstance && typeof (this.serverInstance as any).RegisterService === 'function') {
      return (this.serverInstance as any).RegisterService(impl);
    }
    
    this.logger.warn('Server does not support RegisterService method');
    return undefined;
  }

  /**
   * Get server status
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
    if (this.server) {
      return this.server;
    }
    
    // Fallback: try to get from server instance
    if (this.serverInstance && typeof (this.serverInstance as any).getNativeServer === 'function') {
      this.server = (this.serverInstance as any).getNativeServer();
      return this.server;
    }
    
    throw new Error('Native server not available. Server may not be started.');
  }

  /**
   * Get server health status
   * @returns Health status information
   */
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
      server: { 
        status: string; 
        uptime: number;
        protocol: string;
        port: number;
      };
      connectionPool?: { 
        status: string; 
        activeConnections: number;
        maxConnections: number;
        utilizationRate: number;
      };
    };
    timestamp: number;
  } {
    const startTime = (this.serverInstance as any)?.startTime || Date.now();
    
    const checks: any = {
      server: {
        status: this.status === 200 ? 'healthy' : 'unhealthy',
        uptime: Date.now() - startTime,
        protocol: this.options.protocol,
        port: this.options.port
      }
    };

    // Get connection pool health status
    if (this.serverInstance && 
        typeof (this.serverInstance as any).getConnectionPoolHealth === 'function') {
      try {
        const poolHealth = (this.serverInstance as any).getConnectionPoolHealth();
        if (poolHealth) {
          checks.connectionPool = {
            status: poolHealth.status || 'unknown',
            activeConnections: poolHealth.activeConnections || 0,
            maxConnections: poolHealth.maxConnections || 0,
            utilizationRate: poolHealth.utilizationRate || 0
          };
        }
      } catch (error) {
        this.logger.debug('Failed to get connection pool health', {}, error);
      }
    }

    // Determine overall health status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (checks.server.status === 'unhealthy' || this.status !== 200) {
      overallStatus = 'unhealthy';
    } else if (checks.connectionPool) {
      if (checks.connectionPool.status === 'degraded') {
        overallStatus = 'degraded';
      } else if (checks.connectionPool.status === 'overloaded' || 
                 checks.connectionPool.utilizationRate > 0.9) {
        overallStatus = 'degraded';
      }
    }

    return {
      status: overallStatus,
      checks,
      timestamp: Date.now()
    };
  }

  /**
   * Get server metrics in Prometheus format
   * @returns Prometheus-formatted metrics
   */
  getMetrics(): string {
    const health = this.getHealthStatus();
    const metrics: string[] = [];

    // Server status metric
    metrics.push('# HELP koatty_server_status Server status (1=running, 0=stopped)');
    metrics.push('# TYPE koatty_server_status gauge');
    metrics.push(`koatty_server_status{protocol="${this.options.protocol}",port="${this.options.port}"} ${this.status === 200 ? 1 : 0}`);

    // Server uptime metric
    metrics.push('# HELP koatty_server_uptime_seconds Server uptime in seconds');
    metrics.push('# TYPE koatty_server_uptime_seconds counter');
    metrics.push(`koatty_server_uptime_seconds{protocol="${this.options.protocol}"} ${(health.checks.server.uptime / 1000).toFixed(2)}`);

    // Connection pool metrics
    if (health.checks.connectionPool) {
      const pool = health.checks.connectionPool;
      
      metrics.push('# HELP koatty_connection_pool_active Active connections');
      metrics.push('# TYPE koatty_connection_pool_active gauge');
      metrics.push(`koatty_connection_pool_active{protocol="${this.options.protocol}"} ${pool.activeConnections}`);

      metrics.push('# HELP koatty_connection_pool_max Maximum connections');
      metrics.push('# TYPE koatty_connection_pool_max gauge');
      metrics.push(`koatty_connection_pool_max{protocol="${this.options.protocol}"} ${pool.maxConnections}`);

      metrics.push('# HELP koatty_connection_pool_utilization Connection pool utilization rate (0-1)');
      metrics.push('# TYPE koatty_connection_pool_utilization gauge');
      metrics.push(`koatty_connection_pool_utilization{protocol="${this.options.protocol}"} ${pool.utilizationRate.toFixed(4)}`);
    }

    // Get detailed metrics from server instance
    if (this.serverInstance && 
        typeof (this.serverInstance as any).getConnectionStats === 'function') {
      try {
        const stats = (this.serverInstance as any).getConnectionStats();
        
        if (stats) {
          metrics.push('# HELP koatty_connections_total Total connections since start');
          metrics.push('# TYPE koatty_connections_total counter');
          metrics.push(`koatty_connections_total{protocol="${this.options.protocol}"} ${stats.totalConnections || 0}`);

          metrics.push('# HELP koatty_connections_per_second Connections per second');
          metrics.push('# TYPE koatty_connections_per_second gauge');
          metrics.push(`koatty_connections_per_second{protocol="${this.options.protocol}"} ${(stats.connectionsPerSecond || 0).toFixed(2)}`);

          metrics.push('# HELP koatty_connection_latency_seconds Average connection latency');
          metrics.push('# TYPE koatty_connection_latency_seconds gauge');
          metrics.push(`koatty_connection_latency_seconds{protocol="${this.options.protocol}"} ${((stats.averageLatency || 0) / 1000).toFixed(4)}`);

          metrics.push('# HELP koatty_connection_error_rate Error rate (0-1)');
          metrics.push('# TYPE koatty_connection_error_rate gauge');
          metrics.push(`koatty_connection_error_rate{protocol="${this.options.protocol}"} ${(stats.errorRate || 0).toFixed(4)}`);
        }
      } catch (error) {
        this.logger.debug('Failed to get connection stats', {}, error);
      }
    }

    return metrics.join('\n');
  }

  /**
   * Create health check middleware for Express/Koa
   * @returns Middleware function
   */
  healthCheckMiddleware() {
    return async (ctx: any, next: () => Promise<void>) => {
      const path = ctx.path || ctx.url;
      
      // Health check endpoint
      if (path === '/health' || path === '/healthz') {
        const health = this.getHealthStatus();
        ctx.status = health.status === 'healthy' ? 200 : 503;
        ctx.type = 'application/json';
        ctx.body = health;
        return;
      }
      
      // Metrics endpoint
      if (path === '/metrics') {
        ctx.status = 200;
        ctx.type = 'text/plain; version=0.0.4';
        ctx.body = this.getMetrics();
        return;
      }
      
      await next();
    };
  }

  /**
   * Create server based on configuration
   */
  private createServer(traceId?: string): void {
    const protocolType = this.options.protocol;
    const port = this.options.port;
    
    const options: SingleServerOptions = {
      hostname: this.options.hostname,
      port,
      protocol: protocolType,
      trace: this.options.trace,
      ext: {
        ...this.options.ext
      }
    };

    try {
      this.logger.info('Creating server', { 
        traceId, 
        protocol: protocolType, 
        port: port 
      });

      // Handle secure protocols with error handling
      const secureProtocols = new Set(["https", "http2", "http3", "wss"]);
      if (secureProtocols.has(protocolType)) {
        this.configureSSLForProtocol(protocolType, options, traceId);
      }

      if (["https", "http2", "http3"].includes(protocolType) && port === 80) {
        options.port = 443;
      }

      if (protocolType === "grpc") {
        options.ext.protoFile = this.app.config("protoFile", "router");
      }

      // Handle WebSocket specific options
      if (["ws", "wss"].includes(protocolType)) {
        this.configureWebSocketOptions(options, traceId);
      }

      const server = this.createServerInstance(protocolType, options);
      this.serverInstance = server;

      // Start the server
      server.Start(() => {
        try {
          // Set the native server instance
          if (typeof (server as any).getNativeServer === 'function') {
            this.server = (server as any).getNativeServer();
          }
          
          this.logger.info('Server started successfully', { 
            traceId, 
            protocol: protocolType, 
            port: options.port 
          });
        } catch (error) {
          this.logger.error('Error in server start callback', { traceId }, error);
          this.status = 500;
        }
      });

    } catch (error) {
      this.logger.error('Failed to create server', { 
        traceId, 
        protocol: protocolType, 
        port: port 
      }, error);
      throw error;
    }
  }

  /**
   * Configure SSL for secure protocols
   */
  private configureSSLForProtocol(protocolType: KoattyProtocol, options: SingleServerOptions, traceId?: string): void {
    try {
      const keyFile = this.app.config("key_file") ?? "";
      const crtFile = this.app.config("crt_file") ?? "";
      
      if (!keyFile || !crtFile) {
        const error = new Error(`SSL certificate files not configured for ${protocolType} protocol`);
        this.logger.error('SSL configuration missing', { 
          traceId, 
          protocol: protocolType 
        }, error);
        throw error;
      }
      
      // Check if files exist before reading
      if (!fs.existsSync(keyFile)) {
        const error = new Error(`SSL key file not found: ${keyFile}`);
        this.logger.error('SSL key file not found', { 
          traceId, 
          protocol: protocolType 
        }, error);
        throw error;
      }
      
      if (!fs.existsSync(crtFile)) {
        const error = new Error(`SSL certificate file not found: ${crtFile}`);
        this.logger.error('SSL certificate file not found', { 
          traceId, 
          protocol: protocolType 
        }, error);
        throw error;
      }
      
      options.ext.key = fs.readFileSync(keyFile, 'utf-8');
      options.ext.cert = fs.readFileSync(crtFile, 'utf-8');
      
      this.logger.info('SSL certificates loaded successfully', { 
        traceId, 
        protocol: protocolType 
      }, { 
        keyFile, 
        crtFile 
      });
    } catch (error) {
      this.logger.error('Failed to load SSL certificates', { 
        traceId, 
        protocol: protocolType 
      }, error);
      throw error; // Re-throw to prevent server startup with invalid SSL config
    }
  }

  /**
   * Configure WebSocket specific options
   */
  private configureWebSocketOptions(options: SingleServerOptions, traceId?: string): void {
    const maxConnections = this.app.config("maxConnections", "websocket") || 1000;
    const connectionTimeout = this.app.config("connectionTimeout", "websocket") || 30000;
    
    options.ext = {
      ...options.ext,
      maxConnections,
      connectionTimeout
    };
    
    this.logger.info('WebSocket server configured', { 
      traceId, 
      protocol: options.protocol 
    }, {
      maxConnections,
      connectionTimeout: `${connectionTimeout}ms`
    });
  }

  /**
   * Create server instance based on protocol
   */
  private createServerInstance(protocolType: KoattyProtocol, options: SingleServerOptions): any {
    const serverMap = {
      grpc: GrpcServer,
      ws: WsServer,
      wss: WsServer,
      https: KoattyHttpsServer,
      http2: Http2Server,
      http3: Http3Server,
      http: KoattyHttpServer,
    };

    const ServerConstructor = serverMap[protocolType] || KoattyHttpServer;
    return new ServerConstructor(this.app, options);
  }

}

/**
 * Create Server
 *
 * @export
 * @param {KoattyApplication} app
 * @param {ListeningOptions} [opt]
 * @returns {*}  {KoattyServer}
 */
export function NewServe(app: KoattyApplication, opt?: ListeningOptions): KoattyServer {
  // Safe port parsing with validation
  const parsePort = (envPort: string | undefined): number => {
    if (!envPort) return 3000;
    const parsed = parseInt(envPort, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3000;
  };

  const options: ListeningOptions = {
    hostname: process.env.IP || '127.0.0.1',
    port: parsePort(process.env.PORT || process.env.APP_PORT),
    protocol: 'http',
    ext: {
      key: "",
      cert: "",
      protoFile: "",
      server: null, // used by websocket
    },
    ...opt
  };

  // Validate configuration before creating server
  try {
    validateConfig(options);
  } catch (error) {
    const logger = createLogger({ module: 'serve' });
    logger.error('Invalid server configuration', {}, error);
    throw error;
  }

  // Create single-protocol server
  return new SingleProtocolServer(app, options);
}