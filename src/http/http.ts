/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2021-11-12 18:38:01
 */
import { createServer, Server } from "http";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { HttpStatusCode, TraceBinding } from "koatty_trace";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
export { Server } from "http";
/**
 *
 *
 * @export
 * @class Http
 */
export class HttpServer implements KoattyServer {
    app: Koatty;
    options: ListeningOptions;
    server: Server;
    status: HttpStatusCode;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
    }

    /**
     *
     *
     * @param {boolean} openTrace
     * @param {() => void} listenCallback
     * @memberof Http
     */
    Start(openTrace: boolean, listenCallback: () => void) {
        Logger.Debug("Protocol: HTTP/1.1");
        this.server = createServer((req, res) => {
            TraceBinding(this.app, req, res, openTrace);
        });
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