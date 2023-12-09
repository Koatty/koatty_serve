/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2023-12-09 20:31:23
 */
import { Koatty, KoattyServer } from "koatty_core";
import { CreateTerminus } from "./terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "../index";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
/**
 *
 *
 * @export
 * @class Http
 */
export class HttpServer implements KoattyServer {
  app: Koatty;
  options: ListeningOptions;
  readonly server: Server;
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;

  constructor(app: Koatty, options: ListeningOptions) {
    this.app = app;
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
      callback?.();
      Logger.Error(err);
    });
  }
}