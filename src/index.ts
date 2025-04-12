/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-01-16 00:52:21
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import fs from "fs";
import { KoattyApplication, KoattyServer } from "koatty_core";
import { GrpcServer } from "./server/grpc";
import { WsServer } from "./server/ws";
import { HttpsServer } from "./server/https";
import { Http2Server } from "./server/http2";
import { HttpServer } from "./server/http";
import { ListeningOptions } from "./server/base";

// export
export * from "./utils/terminus";

const secureProtocols = new Set(["https", "http2", "wss"]);
/**
 * Create Server
 *
 * @export
 * @param {Koatty} app
 * @param {KoattyProtocol} [opt]
 * @returns {*}  {KoattyServer}
 */
export function NewServe(app: KoattyApplication, opt?: ListeningOptions): KoattyServer {
  // const protocol = app.config("protocol") || "http";
  // const port = process.env.PORT || process.env.APP_PORT ||
  //   app.config('app_port') || 3000;
  // const hostname = process.env.IP || app.config('app_host') || '127.0.0.1';

  const options: ListeningOptions = {
    hostname: process.env.IP || '127.0.0.1',
    port: process.env.PORT || process.env.APP_PORT || 3000,
    protocol: 'http',
    ext: {
      key_file: "",
      crt_file: "",
      protoFile: "",
      server: null, // used by websocket
    },
    ...opt
  };

  if (secureProtocols.has(options.protocol)) {
    const keyFile = options.ext.key_file ?? "";
    const crtFile = options.ext.crt_file ?? "";
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
  return new ServerConstructor(app, options) as unknown as KoattyServer;
}
