/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 15:06:13
 * @LastEditTime: 2021-06-28 16:19:31
 */
import { createSecureServer, SecureServerOptions } from "http2";
import { Koatty, Logger } from "koatty";
import { TraceBinding } from "koatty_trace";
import { ListeningOptions, Server } from "./index";
import { CreateTerminus } from "./terminus";

/**
 *
 *
 * @export
 * @class Http
 */
export class Http2 implements Server {
    app: Koatty;
    options: ListeningOptions;

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
        Logger.Debug("think", "Protocol: HTTP/2");
        const opt: SecureServerOptions = {
            allowHTTP1: true,
            key: this.options.key,
            cert: this.options.cert,
        }
        const server = createSecureServer(opt, (req, res) => {
            TraceBinding(this.app, req, res, openTrace);
        });
        // Terminus
        CreateTerminus(server);
        server.listen({
            port: this.options.port,
            host: this.options.hostname,
        }, listenCallback).on("clientError", (err: any, sock: any) => {
            // Logger.error("Bad request, HTTP parse error");
            sock.end('400 Bad Request\r\n\r\n');
        });
    }
}