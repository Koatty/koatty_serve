/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2025-04-08 10:48:00
 */
import { Server as HttpServer, IncomingMessage, ServerResponse, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { KoattyApplication } from 'koatty_core';
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import { ServerOptions, WebSocketServer } from 'ws';
import { CreateTerminus } from "../terminus";
import { BaseServer, ListeningOptions } from "./base";

export interface WebSocketServerOptions extends ListeningOptions {
  wsOptions?: ServerOptions;
}

export class WsServer extends BaseServer<WebSocketServerOptions> {
  readonly server: WebSocketServer;
  readonly httpServer: HttpServer | HttpsServer;
  socket: any;

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, options);
    options.ext = options.ext || {};
    this.options.wsOptions = { ...options.ext, ...{ noServer: true } };

    this.server = new WebSocketServer(this.options.wsOptions);
    
    // Set http server
    if (options.ext.server) {
      this.httpServer = options.ext.server;
    } else {
      if (this.options.protocol == "wss") {
        const opt: httpsServerOptions = {
          key: this.options.ext.key,
          cert: this.options.ext.cert,
        };
        this.httpServer = httpsCreateServer(opt);
      } else {
        this.httpServer = createServer();
      }
    }

    CreateTerminus(this);
  }

  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ) {
    this.options = { ...this.options, ...newConfig };
    
    if (changedKeys.includes('port') || changedKeys.includes('hostname')) {
      Logger.Info('Restarting server with new address configuration...');
      this.Stop(() => {
        this.Start(this.listenCallback);
      });
    }
  }

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
      sock.end('400 Bad Request\r\n\r\n');
    });
  }

  Stop(callback?: () => void) {
    this.server.close((err?: Error) => {
      if (callback) callback();
      if (err) Logger.Error(err);
    });
  }
}
