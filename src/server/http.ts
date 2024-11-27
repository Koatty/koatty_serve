/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 17:47:17
 */
import { createServer, Server } from "http";
import { KoattyApplication, KoattyServer } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "../index";
import { CreateTerminus } from "../terminus";
/**
 *
 *
 * @export
 * @class Http
 */
export class HttpServer implements KoattyServer {
  options: ListeningOptions;
  readonly server: Server;
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;

  constructor(app: KoattyApplication, options: ListeningOptions) {
    this.protocol = options.protocol;
    this.options = options;
    this.server = createServer((req, res) => {
      app.callback()(req, res);
    });
    CreateTerminus(this);
  }

  /**
   * Start Server
   *
   * @param {() => void} listenCallback
   * @memberof Http
   */
  Start(listenCallback?: () => void): Server {
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