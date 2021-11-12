/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2021-11-12 14:12:29
 */
import { createSecureServer, Http2SecureServer, SecureServerOptions } from "http2";
import { HttpStatusCode, TraceBinding } from "koatty_trace";
import { CreateTerminus, onSignal } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
export { Http2SecureServer as SecureServer } from "http2";
/**
 *
 *
 * @export
 * @class Http
 */
export class Http2Server implements KoattyServer {
    app: Koatty;
    options: ListeningOptions;
    server: Http2SecureServer;
    status: HttpStatusCode;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        const opt: SecureServerOptions = {
            allowHTTP1: true,
            key: this.options.ext.key,
            cert: this.options.ext.cert,
        }
        this.server = createSecureServer(opt, (req, res) => {
            TraceBinding(this.app, req, res, this.options.trace);
        });
    }

    /**
     * Start
     *
     * @param {boolean} openTrace
     * @param {() => void} listenCallback
     * @memberof Http2Server
     */
    Start(openTrace: boolean, listenCallback: () => void) {
        Logger.Debug("Protocol: HTTP/2");
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