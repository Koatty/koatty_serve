/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2021-11-12 14:17:39
 */
import { createServer, Server, ServerOptions } from "https";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { HttpStatusCode, TraceBinding } from "koatty_trace";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
export { Server } from "https";
/**
 *
 *
 * @export
 * @class Http
 */
export class HttpsServer implements KoattyServer {
    app: Koatty;
    options: ListeningOptions;
    server: Server;
    status: HttpStatusCode;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        const opt: ServerOptions = {
            key: this.options.ext.key,
            cert: this.options.ext.cert,
        }
        this.server = createServer(opt, (req, res) => {
            TraceBinding(this.app, req, res, this.options.trace);
        });
    }

    /**
     *
     *
     * @param {boolean} openTrace
     * @param {() => void} listenCallback
     * @memberof Https
     */
    Start(openTrace: boolean, listenCallback: () => void) {
        Logger.Debug("Protocol: HTTPS/1.1");
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