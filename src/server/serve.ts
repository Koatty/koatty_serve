/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-10-31 13:59:08
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import fs from "fs";
import { KoattyApplication, KoattyServer } from "koatty_core";
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
export function NewServe(app: KoattyApplication, opt?: ListeningOptions): KoattyServer {
  const protocol = app.config("protocol") || "http";
  const port = process.env.PORT || process.env.APP_PORT ||
    app.config('app_port') || 3000;
  const hostname = process.env.IP || app.config('app_host') || '127.0.0.1';

  const options: ListeningOptions = {
    hostname,
    port,
    protocol,
    ext: {
      key: "",
      cert: "",
      protoFile: "",
      server: null, // used by websocket
    },
    ...opt
  };

  const secureProtocols = new Set(["https", "http2", "wss"]);
  if (secureProtocols.has(options.protocol)) {
    const keyFile = app.config("key_file") ?? "";
    const crtFile = app.config("crt_file") ?? "";
    options.ext.key = fs.readFileSync(keyFile, 'utf-8');
    options.ext.cert = fs.readFileSync(crtFile, 'utf-8');
  }
  if (["https", "http2"].includes(options.protocol) && options.port === 80) {
    options.port = 443;
  }
  if (options.protocol === "grpc") {
    options.ext.protoFile = app.config("protoFile", "router");
  }

  const serverMap = {
    grpc: GrpcServer,
    ws: WsServer,
    wss: WsServer,
    https: HttpsServer,
    http2: Http2Server,
    http: HttpServer,
  };

  const ServerConstructor = serverMap[options.protocol] || HttpServer;
  return new ServerConstructor(app, options);
}