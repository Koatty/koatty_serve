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
import { BaseServer, ListeningOptions } from "./base";
/**
 *
 *
 * @export
 * @class HttpServer
 */
export class HttpServer extends BaseServer<ListeningOptions> {
  readonly server: Server;
  private logger = createLogger({ module: 'http', protocol: 'http' });
  private serverId = `http_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

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
    
    this.logger.debug('HTTP server initialized successfully');
    CreateTerminus(this);
  }

  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ) {
    // Merge new config
    this.options = { ...this.options, ...newConfig };

    // Handle special cases
    if (changedKeys.includes('port') || changedKeys.includes('hostname')) {
      this.logger.info('Restarting server with new address configuration');
      this.Stop(() => {
        this.Start(this.listenCallback);
      });
    }
  }

  /**
   * Start Server
   *
   * @param {() => void} listenCallback
   * @memberof HttpServer
   */
  Start(listenCallback?: () => void): Server {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    listenCallback = listenCallback ? listenCallback : this.listenCallback;
    
    return this.server.listen({
      port: this.options.port,
      host: this.options.hostname,
    }, () => {
      this.logger.logServerEvent('started', { traceId }, {
        address: this.server.address(),
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol
      });
      if (listenCallback) listenCallback();
    }).on("clientError", (err: any, sock: any) => {
      this.logger.error('HTTP client error', { traceId }, err);
      try {
        sock.end('400 Bad Request\r\n\r\n');
      } catch (socketError) {
        this.logger.error('Failed to send error response', { traceId }, socketError);
      }
    }).on("error", (err: Error) => {
      this.logger.logServerEvent('error', { traceId }, err);
    });
  }

  /**
   * Stop Server
   *
   */
  Stop(callback?: () => void): void {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId });

    this.server.close((err?: Error) => {
      if (err) {
        this.logger.logServerEvent('error', { traceId }, err);
        return;
      }
      this.logger.logServerEvent('stopped', { traceId });
      if (callback) callback();
    });
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
