/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2022-02-23 14:12:13
 */
import { createServer, Server } from "http";
import { Koatty, KoattyServer } from "koatty_core";
import { HttpStatusCode } from "koatty_exception";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "../index";
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

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
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