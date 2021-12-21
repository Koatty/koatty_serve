/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2021-12-21 11:49:15
 */
import { createServer, Server } from "http";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { HttpStatusCode } from "koatty_exception";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { listenCallback } from "../callback";
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
    status: HttpStatusCode;
    callback: () => void;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        this.callback = listenCallback(app, options);
        this.server = createServer((req, res) => {
            app.callback()(req, res);
        });
    }

    /**
     * Start Server
     *
     * @param {() => void} listenCallback
     * @memberof Http
     */
    Start(listenCallback: () => void) {
        Logger.Log('think', '', "Protocol: HTTP/1.1");
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