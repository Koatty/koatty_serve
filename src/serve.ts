/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2022-09-09 16:16:14
 * @LastEditTime: 2022-10-31 14:56:35
 */
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
