/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2021-11-18 23:17:04
 */
import { URL } from "url";
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer, ListeningOptions } from 'koatty_core';
import { HttpStatusCode } from "koatty_exception";
import WebSocket, { ServerOptions, WebSocketServer } from 'ws';
import { CreateTerminus, onSignal } from "../terminus";
import { Server as HttpServer, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { listenCallback } from "../callback";

export interface WebSocketServerOptions extends ListeningOptions {
    wsOptions?: ServerOptions;
}
/**
 *
 *
 * @export
 * @class Http
 */
export class WsServer implements KoattyServer {
    app: Koatty;
    options: WebSocketServerOptions;
    server: WebSocketServer;
    httpServer: HttpServer | HttpsServer;
    status: HttpStatusCode;
    socket: any;
    callback: () => void;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        this.callback = listenCallback(app, options);
        options.ext = options.ext || {};
        this.options.wsOptions = { ...options.ext, ...{ noServer: true } }

        if (this.options.protocol == "wss") {
            const opt: httpsServerOptions = {
                key: this.options.ext.key,
                cert: this.options.ext.cert,
            }
            this.httpServer = httpsCreateServer(opt);
        } else {
            this.httpServer = createServer();
        }

        const wss = new WebSocketServer(this.options.wsOptions);
        wss.on("connection", (socket: WebSocket, req: any) => {
            this.onConnection(socket, req);
        });

        this.httpServer.on('upgrade', function upgrade(request: any, socket: any, head: any) {
            wss.handleUpgrade(request, socket, head, function done(ws) {
                wss.emit('connection', ws, request);
            });
        });
        this.server = wss;
    }

    /**
     * 
     *
     * @param {WebSocket} socket
     * @param {*} req
     * @memberof WsServer
     */
    private onConnection(socket: WebSocket, req: any) {
        const baseURL = req.headers.origin || 'ws://127.0.0.1:3000';
        const { pathname } = new URL(req.url, baseURL);
        const router: Map<string, Function> = this.app.router.ListRouter();

        if (router.has(pathname)) {
            socket.on('message', async function message(data) {
                const fn = router.get(pathname);
                fn && fn(socket, req, data);
            });
        } else {
            socket.close();
        }
    }

    /**
     * Start Server
     *
     * @param {() => void} listenCallback
     * @returns {*}  
     * @memberof WsServer
     */
    Start(listenCallback: () => void) {
        Logger.Debug(`Protocol: ${this.options.protocol.toUpperCase()}`);
        listenCallback = listenCallback || this.callback;
        // Terminus
        CreateTerminus(this.httpServer);
        this.httpServer.listen({
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