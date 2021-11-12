/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 14:47:26
 * @LastEditTime: 2021-11-12 11:58:41
 */
import { Koatty, ListeningOptions } from "koatty_core";
import { TraceServerSetup } from "koatty_trace";
import { GrpcServer } from "./grpc/grpc";
import { HttpServer } from "./http/http";
import { Http2Server } from "./http/http2";
import * as Helper from "koatty_lib";
import { HttpsServer } from "./http/https";
import { WsServer } from "./websocket/ws";
// export
export * from "./http/http";
export * from "./http/http2";
export * from "./grpc/grpc";
export * from "./terminus";

/**
 * Start Server
 *
 * @export
 * @param {Koatty} app
 * @param {ListeningOptions} options
 * @param {() => void} listenCallback
 * @returns {*}  
 */
export function Serve(app: Koatty, options: ListeningOptions,
    listenCallback: () => void) {
    const openTrace = app.config("open_trace") || false;
    if (openTrace) {
        TraceServerSetup(app);
    }
    let server;
    switch (options.protocol) {
        case "https":
            server = new HttpsServer(app, options);
            break;
        case "http2":
            server = new Http2Server(app, options);
            break;
        case "grpc":
            server = new GrpcServer(app, options);
            break;
        case "ws":
        case "wss":
            server = new WsServer(app, options);
            break;
        case "http":
        default:
            server = new HttpServer(app, options);
    }
    Helper.define(app, "server", server);
    return server.Start(openTrace, listenCallback);
}
