/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2024-10-31 11:45:01
 */
import { createServer, Server, ServerOptions } from "https";
import { KoattyApplication } from "koatty_core";
import { BaseServer } from "./base";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "./base";
import { CreateTerminus } from "../terminus";

/**
 *
 *
 * @export
 * @class Http
 */
export class HttpsServer extends BaseServer<ListeningOptions> {
  readonly server: Server;

  constructor(app: KoattyApplication, options: ListeningOptions) {
    super(app, options);
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
