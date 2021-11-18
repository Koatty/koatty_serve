/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 14:47:26
 * @LastEditTime: 2021-11-18 11:52:46
 */
import fs from "fs";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { GrpcServer } from "./grpc/grpc";
import { HttpServer } from "./http/http";
import { Http2Server } from "./http/http2";
import { HttpsServer } from "./http/https";
import { WsServer } from "./websocket/ws";
// export
export * from "./http/http";
export * from "./http/http2";
export * from "./grpc/grpc";
export * from "./terminus";

/**
 * Create Server
 *
 * @export
 * @param {Koatty} app
 * @param {string} [protocol]
 * @returns {*}  {KoattyServer}
 */
export function Serve(app: Koatty, protocol?: string): KoattyServer {
    const port = process.env.PORT || process.env.APP_PORT ||
        app.config('app_port') || 3000;
    const hostname = process.env.IP ||
        process.env.HOSTNAME?.replace(/-/g, '.') || app.config('app_host') || 'localhost';
    const options: ListeningOptions = {
        hostname: hostname,
        port: port,
        protocol: protocol,
        ext: {
            key: "",
            cert: "",
            protoFile: "",
        }
    }
    const pm = new Set(["https", "http2", "wss"])
    if (pm.has(protocol)) {
        const keyFile = app.config("key_file") ?? "";
        const crtFile = app.config("crt_file") ?? "";
        options.ext.key = fs.readFileSync(keyFile).toString();
        options.ext.cert = fs.readFileSync(crtFile).toString();
    }
    if (protocol === "https" || protocol === "http2") {
        options.port = options.port == 80 ? 443 : options.port;
    }
    if (protocol === "grpc") {
        const proto = app.config("protoFile", "router");
        options.ext.protoFile = proto;
    }

    switch (options.protocol) {
        case "https":
            return new HttpsServer(app, options);
            break;
        case "http2":
            return new Http2Server(app, options);
            break;
        case "grpc":
            return new GrpcServer(app, options);
            break;
        case "ws":
        case "wss":
            return new WsServer(app, options);
            break;
        case "http":
        default:
            return new HttpServer(app, options);
    }
}
