/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2021-11-12 18:26:07
 */
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer, ListeningOptions } from 'koatty_core';
import { HttpStatusCode } from 'koatty_trace';
import { WebSocketServer } from 'ws';
import { HttpServer } from '../http/http';
import { HttpsServer } from "../http/https";
import { onSignal } from "../terminus";

/**
 *
 *
 * @export
 * @class Http
 */
export class WsServer implements KoattyServer {
    app: Koatty;
    options: ListeningOptions;
    server: WebSocketServer;
    httpServer: HttpServer | HttpsServer;
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
     * @returns {*}  
     * @memberof WsServer
     */
    Start(openTrace: boolean, listenCallback: () => void) {
        if (this.options.protocol == "wss") {
            Logger.Debug("Protocol: wss");
            this.httpServer = new HttpsServer(this.app, this.options);
        } else {
            Logger.Debug("Protocol: ws");
            this.httpServer = new HttpServer(this.app, this.options);
        }

        this.httpServer.Start(openTrace, () => {
            this.server = new WebSocketServer({ server: this.httpServer.server });
            listenCallback();
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