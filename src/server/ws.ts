/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2023-01-13 16:05:07
 */
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer } from 'koatty_core';
import { ServerOptions, WebSocketServer } from 'ws';
import { CreateTerminus } from "./terminus";
import { Server as HttpServer, IncomingMessage, ServerResponse, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { ListeningOptions } from "../index";
import { Helper } from "koatty_lib";
export interface WebSocketServerOptions extends ListeningOptions {
  wsOptions?: ServerOptions;
}
/**
 *
 *
 * @export
 * @class Http
 */
export class WsServer implements KoattyServer {
  app: Koatty;
  options: WebSocketServerOptions;
  readonly server: WebSocketServer;
  readonly protocol: string;
  status: number;
  socket: any;
  listenCallback?: () => void;
  readonly httpServer: HttpServer | HttpsServer;

  constructor(app: Koatty, options: ListeningOptions) {
    this.app = app;
    this.protocol = options.protocol;
    this.options = options;
    options.ext = options.ext || {};
    this.options.wsOptions = { ...options.ext, ...{ noServer: true } }

    this.server = new WebSocketServer(this.options.wsOptions);
    if (this.options.protocol == "wss") {
      const opt: httpsServerOptions = {
        key: this.options.ext.key,
        cert: this.options.ext.cert,
      }
      this.httpServer = httpsCreateServer(opt);
    } else {
      this.httpServer = createServer();
    }
    CreateTerminus(this);
  }

  /**
   * Start Server
   *
   * @param {() => void} listenCallback
   * @returns {*}  
   * @memberof WsServer
   */
  Start(listenCallback?: () => void): HttpServer<typeof IncomingMessage, typeof ServerResponse> {
    listenCallback = listenCallback ? listenCallback : this.listenCallback;
    return this.httpServer.listen({
      port: this.options.port,
      host: this.options.hostname,
    }, listenCallback).on('upgrade', (request: any, socket: any, head: any) => {
      this.server.handleUpgrade(request, socket, head, (client, req) => {
        client.on('message', (data) => {
          Helper.define(req, "data", data, true);
          this.app.callback(this.options.protocol)(req, client);
        }).on("error", (err) => {
          Logger.Error(err);
          client.close();
        });
      });
    }).on("clientError", (err: any, sock: any) => {
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
      callback && callback();
      Logger.Error(err);
    });
  }
}