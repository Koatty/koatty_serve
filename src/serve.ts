/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2022-09-09 16:16:14
 * @LastEditTime: 2023-07-26 22:10:39
 */
import fs from "fs";
import { Koatty, KoattyServer } from "koatty_core";
import { GrpcServer } from "./grpc/serve";
import { HttpServer } from "./http/http";
import { Http2Server } from "./http/http2";
import { HttpsServer } from "./http/https";
// import { HttpsServer } from "./http/https";
import { WsServer } from "./websocket/serve";

// KoattyProtocol
export type KoattyProtocol = 'http' | "https" | 'http2' | 'grpc' | 'ws' | 'wss';

/**
 * listening options
 *
 * @interface ListeningOptions
 */
export interface ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol;
  trace?: boolean; // Full stack debug & trace, default: false
  ext?: any; // Other extended configuration
}

/**
 * Create Server
 *
 * @export
 * @param {Koatty} app
 * @param {KoattyProtocol} [opt]
 * @returns {*}  {KoattyServer}
 */
export function NewServe(app: Koatty, opt?: ListeningOptions): KoattyServer {
  const protocol = app.config("protocol") || "http";
  const port = process.env.PORT || process.env.APP_PORT ||
    app.config('app_port') || 3000;
  const hostname = process.env.IP ||
    process.env.HOSTNAME?.replace(/-/g, '.') || app.config('app_host') || '127.0.0.1';

  const options: ListeningOptions = {
    ...{
      hostname: hostname,
      port: port,
      protocol: protocol,
      ext: {
        key: "",
        cert: "",
        protoFile: "",
      },
    }, ...opt
  };
  const pm = new Set(["https", "http2", "wss"])
  if (pm.has(options.protocol)) {
    const keyFile = app.config("key_file") ?? "";
    const crtFile = app.config("crt_file") ?? "";
    options.ext.key = fs.readFileSync(keyFile).toString();
    options.ext.cert = fs.readFileSync(crtFile).toString();
  }
  if (options.protocol === "https" || options.protocol === "http2") {
    options.port = options.port == 80 ? 443 : options.port;
  }
  if (options.protocol === "grpc") {
    const proto = app.config("protoFile", "router");
    options.ext.protoFile = proto;
  }

  let server: KoattyServer;
  switch (options.protocol) {
    case "grpc":
      server = new GrpcServer(app, options);
      break;
    case "ws":
    case "wss":
      server = new WsServer(app, options);
      break;
    case "https":
      server = new HttpsServer(app, options);
      break;
    case "http2":
      server = new Http2Server(app, options);
      break;
    case "http":
    default:
      server = new HttpServer(app, options);
      break;
  }
  return server;
}