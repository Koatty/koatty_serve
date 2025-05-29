/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2024-11-27 17:47:17
 */
import { createServer, Server } from "http";
import { KoattyApplication, NativeServer } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ListeningOptions } from "./base";
/**
 *
 *
 * @export
 * @class Http
 */
export class HttpServer extends BaseServer<ListeningOptions> {
  readonly server: Server;

  constructor(app: KoattyApplication, options: ListeningOptions) {
    super(app, options);
    this.server = createServer((req, res) => {
      app.callback()(req, res);
    });
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
      Logger.Info('Restarting server with new address configuration...');
      this.Stop(() => {
        this.Start(this.listenCallback);
      });
    }
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
  Stop(callback?: () => void): void {
    this.server.close((err?: Error) => {
      if (err) {
        Logger.Error(err);
        return;
      }
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
