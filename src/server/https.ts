/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2024-10-31 11:45:01
 */
import { createServer, Server, ServerOptions } from "https";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer } from "./base";
import { createLogger, generateTraceId } from "../utils/structured-logger";
import { ListeningOptions } from "./base";
import { CreateTerminus } from "../utils/terminus";

/**
 *
 *
 * @export
 * @class HttpsServer
 */
export class HttpsServer extends BaseServer<ListeningOptions> {
  readonly server: Server;
  private logger = createLogger({ module: 'https', protocol: 'https' });
  private serverId = `https_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  constructor(app: KoattyApplication, options: ListeningOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'https', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.logger.info('Initializing HTTPS server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol
    });

    const opt: ServerOptions = {
      key: this.options.ext.key,
      cert: this.options.ext.cert,
    };
    
    this.server = createServer(opt, (req, res) => {
      app.callback()(req, res);
    });
    
    this.logger.debug('HTTPS server initialized successfully');
    CreateTerminus(this);
  }

  /**
   * Start Server
   *
   * @param {boolean} openTrace
   * @param {() => void} listenCallback
   * @memberof HttpsServer
   */
  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ) {
    this.options = { ...this.options, ...newConfig };
    
    if (changedKeys.includes('port') || changedKeys.includes('hostname')) {
      this.logger.info('Restarting server with new address configuration');
      this.Stop(() => {
        this.Start(this.listenCallback);
      });
    }
  }

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
      this.logger.error('HTTPS client error', { traceId }, err);
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
