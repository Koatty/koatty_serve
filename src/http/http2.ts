/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2021-12-21 11:49:20
 */
import { createSecureServer, Http2SecureServer, SecureServerOptions } from "http2";
import { HttpStatusCode } from "koatty_exception";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { listenCallback } from "../callback";
/**
 *
 *
 * @export
 * @class Http
 */
export class Http2Server implements KoattyServer {
    app: Koatty;
    options: ListeningOptions;
    readonly server: Http2SecureServer;
    status: HttpStatusCode;
    callback: () => void;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        this.callback = listenCallback(app, options);
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
    Start(listenCallback: () => void) {
        Logger.Log('think', '', "Protocol: HTTP/2");
        listenCallback = listenCallback || this.callback;
        // Terminus
        CreateTerminus(this.server);
        this.server.listen({
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
    Stop() {
        onSignal();
        this.server.close((err?: Error) => {
            Logger.Error(err);
        });
    }
}