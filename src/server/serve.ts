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
import { GrpcServer } from "./grpc";
import { HttpServer as KoattyHttpServer } from "./http";
import { Http2Server } from "./http2";
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
  private logger = createLogger({ module: 'singleprotocol' });

  readonly protocol: string = 'http';
  readonly options: ListeningOptions;
  readonly server: NativeServer; // Native server instance (for KoattyServer interface)
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

    // Initialize server as null, will be set when server is created
    (this as any).server = null;
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
      this.logger.logServerEvent('starting', { traceId }, {
        protocol: this.options.protocol,
        hostname: this.options.hostname,
        port: this.options.port
      });

      // Create and start server
      this.createServer(traceId);
      
      // Update status to indicate server is running
      this.status = this.serverInstance ? 200 : 500;
      
      this.logger.logServerEvent('started', { traceId }, {
        protocol: this.options.protocol,
        port: this.options.port
      });

      if (this.listenCallback) {
        this.listenCallback();
      }
      
      return this;
    } catch (error) {
      this.logger.logServerEvent('error', { traceId }, error);
      throw error;
    }
  }

  /**
   * Stop server
   */
  Stop(callback?: () => void): void {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId }, {
      protocol: this.options.protocol,
      port: this.options.port
    });

    if (this.serverInstance && typeof this.serverInstance.Stop === 'function') {
      this.serverInstance.Stop(() => {
        this.serverInstance = null;
        (this as any).server = null;
        this.status = 0;
        this.logger.logServerEvent('stopped', { traceId });
        if (callback) callback();
      });
    } else {
      this.logger.warn('Server has no Stop method', { traceId });
      this.serverInstance = null;
      (this as any).server = null;
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
    if (this.serverInstance && typeof (this.serverInstance as any).getNativeServer === 'function') {
      return (this.serverInstance as any).getNativeServer();
    }
    
    return this.server;
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
      const secureProtocols = new Set(["https", "http2", "wss"]);
      if (secureProtocols.has(protocolType)) {
        this.configureSSLForProtocol(protocolType, options, traceId);
      }

      if (["https", "http2"].includes(protocolType) && port === 80) {
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
        // Set the native server instance
        if (typeof (server as any).getNativeServer === 'function') {
          (this as any).server = (server as any).getNativeServer();
        }
        
        this.logger.info('Server started successfully', { 
          traceId, 
          protocol: protocolType, 
          port: options.port 
        });
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

  // Create single-protocol server
  return new SingleProtocolServer(app, options);
}