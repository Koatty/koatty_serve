/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-12-03 16:23:54
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { KoattyApplication, KoattyServer, NativeServer } from "koatty_core";
import { createLogger, generateTraceId } from "../utils/logger";
import { GrpcServer } from "./grpc";
import { HttpServer as KoattyHttpServer } from "./http";
import { Http2Server } from "./http2";
import { HttpsServer as KoattyHttpsServer } from "./https";
import { WsServer } from "./ws";
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
 * Extended server interface with additional properties
 */
interface ExtendedKoattyServer extends KoattyServer {
  server?: KoattyServer;
  status?: number;
  getNativeServer?: () => NativeServer;
}

/**
 * Multi-protocol server manager
 */
export class MultiProtocolServer implements KoattyServer {
  private app: KoattyApplication;
  private servers: Map<string, KoattyServer> = new Map();
  private failedServers: Map<string, Error> = new Map();
  private logger = createLogger({ module: 'multiprotocol' });
  readonly options: ListeningOptions;
  server?: NativeServer; // 主服务器的原生服务器实例

  constructor(app: KoattyApplication, opt: ListeningOptions) {
    this.app = app;
    this.options = {
      hostname: '127.0.0.1',
      port: 3000,
      protocol: 'http',
      ...opt
    };

    this.logger.info('Multi-protocol server initialized', {}, {
      protocols: this.getProtocolsArray(),
      hostname: this.options.hostname,
      basePort: this.options.port
    });
  }

  /**
   * Start all servers
   */
  Start(listenCallback?: () => void): NativeServer {
    const traceId = generateTraceId();

    try {
      this.logger.logServerEvent('starting', { traceId }, {
        protocols: this.getProtocolsArray(),
        hostname: this.options.hostname,
        basePort: this.options.port
      });

      // Create and start protocol servers
      this.createProtocolServers(traceId, listenCallback);

      this.logger.logServerEvent('started', { traceId }, {
        totalServers: this.servers.size,
        servers: Array.from(this.servers.keys()),
        failedServers: this.failedServers.size
      });

      // 设置主服务器：使用第一个成功启动的服务器作为主服务器
      const primaryServerKey = Array.from(this.servers.keys())[0];
      if (primaryServerKey) {
        const primaryServer = this.servers.get(primaryServerKey);
        if (primaryServer && typeof (primaryServer as ExtendedKoattyServer).getNativeServer === 'function') {
          this.server = (primaryServer as ExtendedKoattyServer).getNativeServer!();
        }
      }

      return this.server || null;
    } catch (error) {
      this.logger.logServerEvent('error', { traceId }, error);
      throw error;
    }
  }

  /**
   * Stop all servers
   */
  Stop(callback?: () => void): void {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId }, {
      totalServers: this.servers.size
    });

    const stopPromises: Promise<void>[] = [];

    // Stop all protocol servers
    this.servers.forEach((server, key) => {
      const promise = new Promise<void>((resolve) => {
        if (server && typeof server.Stop === 'function') {
          server.Stop(() => {
            this.logger.debug('Individual server stopped', { traceId }, { serverKey: key });
            resolve();
          });
        } else {
          this.logger.warn('Server has no Stop method', { traceId }, { serverKey: key });
          resolve();
        }
      });
      stopPromises.push(promise);
    });

    Promise.allSettled(stopPromises).then((results) => {
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        this.logger.warn('Some servers failed to stop properly', { traceId }, {
          failureCount: failures.length
        });
      }

      this.servers.clear();
      this.failedServers.clear();
      this.logger.logServerEvent('stopped', { traceId });
      if (callback) callback();
    });
  }

  /**
   * Register Service for gRPC server
   */
  RegisterService(impl: (...args: any[]) => any, protocolType?: KoattyProtocol, port?: number) {
    // Safer type handling without unsafe type assertions
    let targetProtocol: KoattyProtocol;

    if (protocolType) {
      targetProtocol = protocolType;
    } else {
      const protocols = this.getProtocolsArray();
      targetProtocol = protocols[0];
    }

    const targetPort = port ?? this.options.port;
    const server = this.getServer(targetProtocol, targetPort);

    return server?.RegisterService?.(impl);
  }

  /**
   * Get status by protocol and port
   * @param protocolType 
   * @param port 
   * @returns 
   */
  getStatus(protocolType?: KoattyProtocol, port?: number): number {
    const server = this.getServer(protocolType, port);
    if (server && typeof (server as ExtendedKoattyServer).getStatus === 'function') {
      return (server as ExtendedKoattyServer).getStatus!();
    }
    return 0;
  }

  /**
   * Get native server by protocol and port
   * @param protocolType 
   * @param port 
   * @returns 
   */
  getNativeServer(protocolType?: KoattyProtocol, port?: number): NativeServer {
    const server = this.getServer(protocolType, port);

    if (server && typeof (server as ExtendedKoattyServer).getNativeServer === 'function') {
      return (server as ExtendedKoattyServer).getNativeServer!();
    }

    return null;
  }

  /**
   * Get server by protocol and port
   */
  getServer(protocolType?: KoattyProtocol, port?: number): KoattyServer | undefined {
    const defaultProtocol = protocolType || this.getProtocolsArray()[0];
    const defaultPort = port || this.options.port;

    return this.servers.get(`${defaultProtocol}:${defaultPort}`);
  }

  /**
   * Get all running servers
   */
  getAllServers(): Map<string, KoattyServer> {
    return this.servers;
  }

  /**
   * Get all failed servers
   */
  getFailedServers(): Map<string, Error> {
    return this.failedServers;
  }

  /**
   * Get protocols as array
   */
  private getProtocolsArray(): KoattyProtocol[] {
    return Array.isArray(this.options.protocol)
      ? this.options.protocol
      : [this.options.protocol];
  }

  /**
   * Create protocol servers based on configuration
   */
  private createProtocolServers(traceId?: string, listenCallback?: () => void): void {
    const protocols = this.getProtocolsArray();

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

      try {
        this.logger.info('Creating individual server', {
          traceId,
          protocol: protocolType,
          port: port
        });

        const server = this.createServerInstance(protocolType, options);
        const serverKey = `${protocolType}:${options.port}`;
        this.servers.set(serverKey, server);

        // Start the server
        server.Start(listenCallback);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error('Failed to create individual server', {
          traceId,
          protocol: protocolType,
          port: port
        }, error);

        // Record failed server but continue with others
        this.failedServers.set(`${protocolType}:${port}`, error instanceof Error ? error : new Error(errorMessage));

        // Only throw if this is the last protocol and no servers were created successfully
        if (index === protocols.length - 1 && this.servers.size === 0) {
          throw new Error(`All servers failed to start. Last error: ${errorMessage}`);
        }
      }
    });

    // Log summary
    if (this.failedServers.size > 0) {
      this.logger.warn('Some servers failed to start', { traceId }, {
        successfulServers: this.servers.size,
        failedServers: this.failedServers.size,
        failures: Array.from(this.failedServers.keys())
      });
    }
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

  // Ensure protocol is always an array internally for consistent handling
  // The MultiProtocolServer will handle both single and multiple protocols properly

  // Create multi-protocol server
  return new MultiProtocolServer(app, options);
}