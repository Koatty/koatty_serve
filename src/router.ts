/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2022-10-29 11:15:30
 * @LastEditTime: 2023-07-26 22:24:30
 */
import { GrpcRouter } from "./grpc/router";
import { HttpRouter } from "./http/router";
import { WebsocketRouter } from "./websocket/router";
import { Koatty, KoattyRouter } from "koatty_core";
import { Helper } from "koatty_lib";

/**
 * RouterOptions
 *
 * @export
 * @interface RouterOptions
 */
export interface RouterOptions {
  protocol: string;
  prefix: string;
  /**
   * Methods which should be supported by the router.
   */
  methods?: string[];
  routerPath?: string;
  /**
   * Whether or not routing should be case-sensitive.
   */
  sensitive?: boolean;
  /**
   * Whether or not routes should matched strictly.
   *
   * If strict matching is enabled, the trailing slash is taken into
   * account when matching routes.
   */
  strict?: boolean;
  /**
   * gRPC protocol file
   */
  protoFile?: string;
  // 
  /**
   * Other extended configuration
   */
  ext?: any;
}

/**
 * get instance of Router
 *
 * @export
 * @param {Koatty} app
 * @param {RouterOptions} options
 * @param {string} [protocol]
 * @returns {*}  {KoattyRouter}
 */
export function NewRouter(app: Koatty, opt?: RouterOptions): KoattyRouter {
  const protocol = app.config("protocol") || "http";
  const opts: RouterOptions = app.config(undefined, 'router') ?? {};

  const options: RouterOptions = {
    ...{ protocol: protocol, prefix: "" }, ...opts, ...opt
  }
  let router;
  switch (protocol) {
    case "grpc":
      router = new GrpcRouter(app, options);
      Helper.define(router, "protocol", protocol);
      break;
    case "ws":
    case "wss":
      router = new WebsocketRouter(app, options);
      Helper.define(router, "protocol", protocol);
      break;
    default:
      router = new HttpRouter(app, options);
      Helper.define(router, "protocol", protocol);
  }
  return router;
}