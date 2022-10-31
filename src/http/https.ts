/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2022-10-29 11:29:36
 */
import { createServer, Server, ServerOptions } from "https";
import { Koatty, KoattyServer } from "koatty_core";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "../index";

/**
 *
 *
 * @export
 * @class Http
 */
export class HttpsServer implements KoattyServer {
  app: Koatty;
  options: ListeningOptions;
  readonly server: Server;
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;

  /**
   * Creates an instance of HttpsServer.
   * @param {Koatty} app
   * @param {ListeningOptions} options
   * @memberof HttpsServer
   */
  constructor(app: Koatty, options: ListeningOptions) {
    this.app = app;
    this.protocol = options.protocol;
    this.options = options;
    const opt: ServerOptions = {
      key: this.options.ext.key,
      cert: this.options.ext.cert,
    }
    this.server = createServer(opt, (req, res) => {
      app.callback()(req, res);
    });
  }

  /**
   * Start Server
   *
   * @param {boolean} openTrace
   * @param {() => void} listenCallback
   * @memberof Https
   */
  Start(listenCallback?: () => void) {
    listenCallback = listenCallback ? listenCallback : this.listenCallback;
    // Terminus
    CreateTerminus(this.server);
    return this.server.listen({
      port: this.options.port,
      host: this.options.hostname,
    }, listenCallback).on("clientError", (err: any, sock: any) => {
      // Logger.error("Bad request, HTTP parse error");
      sock.end('400 Bad Request\r\n\r\n');
    });
  }

  /**
   * Stop Server
   *
   */
  Stop(callback?: () => void) {
    onSignal();
    this.server.close((err?: Error) => {
      callback?.();
      Logger.Error(err);
    });
  }
}