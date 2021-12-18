/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:48:01
 * @LastEditTime: 2021-12-18 23:43:23
 */
import { createServer, Server, ServerOptions } from "https";
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
export class HttpsServer implements KoattyServer {
    app: Koatty;
    options: ListeningOptions;
    readonly server: Server;
    status: HttpStatusCode;
    callback: () => void;

    /**
     * Creates an instance of HttpsServer.
     * @param {Koatty} app
     * @param {ListeningOptions} options
     * @memberof HttpsServer
     */
    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        this.callback = listenCallback(app, options);
        const opt: ServerOptions = {
            key: this.options.ext.key,
            cert: this.options.ext.cert,
        }
        this.server = createServer(opt, (req, res) => {
            app.callback()(req, res);
        });
    }

    /**
     * Start Server
     *
     * @param {boolean} openTrace
     * @param {() => void} listenCallback
     * @memberof Https
     */
    Start(listenCallback: () => void) {
        Logger.Debug("Protocol: HTTPS/1.1");
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