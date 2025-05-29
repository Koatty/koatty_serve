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
import { DefaultLogger as Logger } from "koatty_logger";
import { GrpcServer } from "./grpc";
import { HttpServer as KoattyHttpServer } from "./http";
import { Http2Server } from "./http2";
import { HttpsServer as KoattyHttpsServer } from "./https";
import { WsServer } from "./ws";
import { CreateTerminus } from "../utils/terminus";

// KoattyProtocol
export type KoattyProtocol = 'http' | "https" | 'http2' | 'grpc' | 'ws' | 'wss';

/**
 * listening options
 *
 * @interface ListeningOptions
 */
export interface ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol | KoattyProtocol[]; // 支持单协议或协议数组
  trace?: boolean; // Full stack debug & trace, default: false
  ext?: any; // Other extended configuration
}

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
 * Multi-protocol server manager
 */
export class MultiProtocolServer implements KoattyServer {
  private app: KoattyApplication;
  private servers: Map<string, KoattyServer> = new Map(); // Use any to avoid type conflicts
  
  readonly protocol: string = 'http';
  readonly options: ListeningOptions;
  listenCallback?: () => void;

  constructor(app: KoattyApplication, opt: ListeningOptions) {
    this.app = app;
    this.options = {
      hostname: '127.0.0.1',
      port: 3000,
      protocol: 'http',
      ...opt
    };

    CreateTerminus(this);
  }

  /**
   * Start all servers
   */
  Start(listenCallback?: () => void): any {
    this.listenCallback = listenCallback;
    
    try {
      // Create and start protocol servers
      this.createProtocolServers();
      
      Logger.Info(`Multi-protocol server started with ${this.servers.size} services`);
      if (this.listenCallback) {
        this.listenCallback();
      }
      
      return this;
    } catch (error) {
      Logger.Error('Failed to start multi-protocol server:', error);
      throw error;
    }
  }

  /**
   * Stop all servers
   */
  Stop(callback?: () => void): void {
    const stopPromises: Promise<void>[] = [];
    
    // Stop all protocol servers
    this.servers.forEach((server, key) => {
      stopPromises.push(new Promise<void>((resolve) => {
        if (server && typeof server.Stop === 'function') {
          server.Stop(() => {
            Logger.Info(`Stopped server: ${key}`);
            resolve();
          });
        } else {
          resolve();
        }
      }));
    });
    
    Promise.all(stopPromises).then(() => {
      this.servers.clear();
      Logger.Info('All servers stopped');
      if (callback) callback();
    }).catch((error) => {
      Logger.Error('Error stopping servers:', error);
      if (callback) callback();
    });
  }

  /**
   * Register service(exp: gRPC])
   * @param impl 
   */
  RegisterService(impl: Function, protocolType?: KoattyProtocol, port?: number) {
    return this.getServer(protocolType, port).RegisterService(impl);
  }

  /**
   * Get status by protocol and port
   * @param protocolType 
   * @param port 
   * @returns 
   */
  getStatus(protocolType?: KoattyProtocol, port?: number): number {
    if (protocolType === undefined) {
      protocolType = this.options.protocol[0] as KoattyProtocol;
    }
    if (port === undefined) {
      port = this.options.port;
    }
    return this.getServer(protocolType, port).getStatus() ?? 0;
  }

  /**
   * Get native server by protocol and port
   * @param protocolType 
   * @param port 
   * @returns 
   */
  getNativeServer(protocolType?: KoattyProtocol, port?: number): NativeServer {
    if (protocolType === undefined) {
      protocolType = this.options.protocol[0] as KoattyProtocol;
    }
    if (port === undefined) {
      port = this.options.port;
    }
    return this.getServer(protocolType, port).getNativeServer();
  }


  /**
   * Get server by protocol and port
   */
  getServer(protocolType: KoattyProtocol, port: number): KoattyServer {
    if (protocolType === undefined) {
      protocolType = this.options.protocol[0] as KoattyProtocol;
    }
    if (port === undefined) {
      port = this.options.port;
    }
    return this.servers.get(`${protocolType}:${port}`);
  }

  /**
   * Get all running servers
   */
  getAllServers(): Map<string, KoattyServer> {
    return this.servers;
  }

  /**
   * Create protocol servers based on configuration
   */
  private createProtocolServers(): void {
    const protocols = Array.isArray(this.options.protocol) 
      ? this.options.protocol 
      : [this.options.protocol];

    protocols.forEach((protocolType, index) => {
      // For multiple protocols, use different ports (base port + index)
      const port = this.options.port + index;
      
      const options: SingleServerOptions = {
        hostname: this.options.hostname,
        port,
        protocol: protocolType,
        trace: this.options.trace,
        ext: {
          ...this.options.ext
        }
      };

      // Handle secure protocols
      const secureProtocols = new Set(["https", "http2", "wss"]);
      if (secureProtocols.has(protocolType)) {
        const keyFile = this.app.config("key_file") ?? "";
        const crtFile = this.app.config("crt_file") ?? "";
        options.ext.key = fs.readFileSync(keyFile, 'utf-8');
        options.ext.cert = fs.readFileSync(crtFile, 'utf-8');
      }

      if (["https", "http2"].includes(protocolType) && port === 80) {
        options.port = 443;
      }

      if (protocolType === "grpc") {
        options.ext.protoFile = this.app.config("protoFile", "router");
      }

      const server = this.createServerInstance(protocolType, options);
      const serverKey = `${protocolType}:${options.port}`;
      this.servers.set(serverKey, server);

      // Start the server
      server.Start(() => {
        Logger.Info(`Server ${serverKey} started successfully`);
      });
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
  const options: ListeningOptions = {
    hostname: process.env.IP || '127.0.0.1',
    port: parseInt(process.env.PORT || process.env.APP_PORT || '3000'),
    protocol: 'http',
    ext: {
      key: "",
      cert: "",
      protoFile: "",
      server: null, // used by websocket
    },
    ...opt
  };

  // If protocol is not an array, convert it to an array
  if (!Array.isArray(options.protocol)) {
    options.protocol = [options.protocol];
  }

  // Create multi-protocol server
  return new MultiProtocolServer(app, options);
}