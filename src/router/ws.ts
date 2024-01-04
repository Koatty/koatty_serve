/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-29 14:16:44
 * @LastEditTime: 2024-01-04 23:09:52
 */

import KoaRouter from "@koa/router";
import { RouterOptions } from "./router";
import { RequestMethod } from "./mapping";
import { IOCContainer } from "koatty_container";
import { DefaultLogger as Logger } from "koatty_logger";
import { Handler, injectParamMetaData, injectRouter } from "./inject";
import { Koatty, KoattyContext, KoattyNext, KoattyRouter } from "koatty_core";
import { Helper } from "koatty_lib";

/**
 * WebsocketRouter Options
 *
 * @export
 * @interface WebsocketRouterOptions
 */
export interface WebsocketRouterOptions extends RouterOptions {
  prefix: string;
}
// WsImplementation
export type WsImplementation = (ctx: KoattyContext, next: KoattyNext) => Promise<any>;

export class WebsocketRouter implements KoattyRouter {
  app: Koatty;
  readonly protocol: string;
  options: WebsocketRouterOptions;
  router: KoaRouter;

  constructor(app: Koatty, options?: RouterOptions) {
    this.app = app;
    this.options = Object.assign({
      prefix: options.prefix
    }, options);
    this.router = new KoaRouter(this.options);
  }

  /**
   * Set router
   *
   * @param {string} path
   * @param {WsImplementation} func
   * @param {RequestMethod} [method]
   * @returns {*}
   * @memberof WebsocketRouter
   */
  SetRouter(path: string, func: WsImplementation, method?: RequestMethod) {
    if (Helper.isEmpty(method)) {
      return;
    }
    method = method ?? RequestMethod.ALL;
    this.router[method](path, func);
  }

  /**
   * ListRouter
   *
   * @returns {*} {KoaRouter.Middleware<any, unknown>}
   */
  ListRouter() {
    return this.router.routes();
  }

  /**
   *
   *
   * @param {any[]} list
   */
  LoadRouter(list: any[]) {
    try {
      for (const n of list) {
        const ctlClass = IOCContainer.getClass(n, "CONTROLLER");
        // inject router
        const ctlRouters = injectRouter(this.app, ctlClass);
        // inject param
        const ctlParams = injectParamMetaData(this.app, ctlClass, this.options.payload);
        // tslint:disable-next-line: forin
        for (const it in ctlRouters) {
          const router = ctlRouters[it];
          const method = router.method;
          let path = router.path || "/";
          if (path.length > 1 && path.endsWith("/")) {
            path = path.slice(0, path.length - 1);
          }
          const requestMethod = <RequestMethod>router.requestMethod;
          const params = ctlParams[method];
          // websocket only handler get request
          if (requestMethod == RequestMethod.GET || requestMethod == RequestMethod.ALL) {
            Logger.Debug(`Register request mapping: [${requestMethod}] : ["${path}" => ${n}.${method}]`);
            this.SetRouter(path, (ctx: KoattyContext): Promise<any> => {
              const ctl = IOCContainer.getInsByClass(ctlClass, [ctx]);
              return Handler(this.app, ctx, ctl, method, params);
            }, requestMethod);
          }

        }
      }
      // Add websocket handler
      this.app.use(this.ListRouter()).
        use(this.router.allowedMethods());
    } catch (err) {
      Logger.Error(err);
    }
  }

}
