/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2024-10-31 11:45:01
 */
import { IncomingMessage, ServerResponse } from "http";
import { createServer, Server, ServerOptions } from "https";
import { KoattyApplication, KoattyServer } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "../index";
import { CreateTerminus } from "./terminus";

/**
 *
 *
 * @export
 * @class Http
 */
export class HttpsServer implements KoattyServer {
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
  constructor(app: KoattyApplication, options: ListeningOptions) {
    this.protocol = options.protocol;
    this.options = options;
    const opt: ServerOptions = {
      key: this.options.ext.key,
      cert: this.options.ext.cert,
    }
    this.server = createServer(opt, (req, res) => {
      app.callback()(req, res);
    });
    CreateTerminus(this);
  }

  /**
   * Start Server
   *
   * @param {boolean} openTrace
   * @param {() => void} listenCallback
   * @memberof Https
   */
  Start(listenCallback?: () => void): Server<typeof IncomingMessage, typeof ServerResponse> {
    listenCallback = listenCallback ? listenCallback : this.listenCallback;
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
    this.server.close((err?: Error) => {
      if (callback) callback();
      if (err) Logger.Error(err);
    });
  }
}