/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2023-12-09 12:31:55
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import fs from "fs";
import { Koatty, KoattyServer } from "koatty_core";
import { GrpcServer } from "./grpc";
import { HttpServer } from "./http";
import { Http2Server } from "./http2";
import { HttpsServer } from "./https";
// import { HttpsServer } from "./http/https";
import { WsServer } from "./ws";

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
  const hostname = process.env.IP || app.config('app_host') || '127.0.0.1';

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