/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2022-10-29 11:29:18
 */
import { createSecureServer, Http2SecureServer, SecureServerOptions } from "http2";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer } from "koatty_core";
import { ListeningOptions } from "../index";
/**
 *
 *
 * @export
 * @class Http
 */
export class Http2Server implements KoattyServer {
  app: Koatty;
  options: ListeningOptions;
  readonly protocol: string;
  readonly server: Http2SecureServer;
  status: number;
  listenCallback?: () => void;

  constructor(app: Koatty, options: ListeningOptions) {
    this.app = app;
    this.protocol = options.protocol;
    this.options = options;
    const opt: SecureServerOptions = {
      allowHTTP1: true,
      key: this.options.ext.key,
      cert: this.options.ext.cert,
    }
    this.server = createSecureServer(opt, (req, res) => {
      app.callback()(req, res);
    });
  }

  /**
   * Start Server
   *
   * @param {() => void} listenCallback
   * @memberof Http2Server
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