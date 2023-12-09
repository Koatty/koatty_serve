/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2023-12-09 23:12:34
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { GrpcRouter } from "./grpc";
import { HttpRouter } from "./http";
import { PayloadOptions } from "./payload";
import { WebsocketRouter } from "./ws";
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

  /**
   * payload options
   */
  payload?: PayloadOptions;
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