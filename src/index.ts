/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 14:47:26
 * @LastEditTime: 2022-03-15 17:38:20
 */
import fs from "fs";
import { Koatty, KoattyServer } from "koatty_core";
import { GrpcServer } from "./grpc/grpc";
import { HttpServer } from "./http/http";
import { Http2Server } from "./http/http2";
import { HttpsServer } from "./http/https";
import { WsServer } from "./websocket/ws";
// export
export * from "./http/http";
export * from "./http/https";
export * from "./http/http2";
export * from "./grpc/grpc";
export * from "./websocket/ws";
export * from "./terminus";
// KoattyProtocol
export type KoattyProtocol = 'http' | 'https' | 'http2' | 'grpc' | 'ws' | 'wss';

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
export function Serve(app: Koatty, opt?: ListeningOptions): KoattyServer {
  const options: ListeningOptions = {
    ...{
      hostname: '127.0.0.1',
      port: 3000,
      protocol: "http",
      ext: {
        key: "",
        cert: "",
        protoFile: "",
      },
    }, ...opt
  };

  switch (options.protocol) {
    case "https":
      return new HttpsServer(app, options);
    case "http2":
      return new Http2Server(app, options);
    case "grpc":
      return new GrpcServer(app, options);
    case "ws":
    case "wss":
      return new WsServer(app, options);
    case "http":
    default:
      return new HttpServer(app, options);
  }
}
