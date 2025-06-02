/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 17:44:37
 */
import { createSecureServer, Http2SecureServer, SecureServerOptions } from "http2";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer } from "./base";
import { createLogger, generateTraceId } from "../utils/structured-logger";
import { ListeningOptions } from "./base";
import { CreateTerminus } from "../utils/terminus";
/**
 *
 *
 * @export
 * @class Http2Server
 */
export class Http2Server extends BaseServer<ListeningOptions> {
  options: ListeningOptions;
  readonly protocol: string;
  readonly server: Http2SecureServer;
  status: number;
  listenCallback?: () => void;
  private logger = createLogger({ module: 'http2', protocol: 'http2' });
  private serverId = `http2_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  constructor(app: KoattyApplication, options: ListeningOptions) {
    super(app, options);
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'http2', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    this.logger.info('Initializing HTTP2 server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol
    });

    const opt: SecureServerOptions = {
      allowHTTP1: true,
      key: this.options.ext.key,
      cert: this.options.ext.cert,
    };
    
    this.server = createSecureServer(opt, (req, res) => {
      app.callback()(req, res);
    });
    
    this.logger.debug('HTTP2 server initialized successfully');
    CreateTerminus(this);
  }

  /**
   * Start Server
   *
   * @param {() => void} listenCallback
   * @memberof Http2Server
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

  Start(listenCallback?: () => void): Http2SecureServer {
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
      this.logger.error('HTTP2 client error', { traceId }, err);
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
