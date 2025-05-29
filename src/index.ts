/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-01-16 00:52:21
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

// Export server implementations
export { GrpcServer } from "./server/grpc";
export { HttpServer } from "./server/http";
export { Http2Server } from "./server/http2";
export { HttpsServer } from "./server/https";
export { WsServer } from "./server/ws";

// Export serve functions and types
export { 
  NewServe, 
  MultiProtocolServer,
  type KoattyProtocol,
  type ListeningOptions
} from "./server/serve";

// Export utilities
export * from "./utils/terminus";


// TODO: 修改KoattyServer接口
// export declare interface KoattyServer {
//   options: any;
//   readonly Start: (listenCallback: () => void) => NativeServer;
//   readonly Stop: (callback?: () => void) => void;

//   readonly getStatus?: (protocolType?: string, port?: number) => number;
//   readonly getNativeServer?: (protocolType?: string, port?: number) => NativeServer;
//   /**
//    * service register(exp: gRPC)
//    * @param {ServiceImplementation} impl
//    */
//   readonly RegisterService?: (impl: any) => void;
// }