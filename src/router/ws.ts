/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-29 14:16:44
 * @LastEditTime: 2024-01-15 22:39:27
 */

import KoaRouter from "@koa/router";
import { RouterOptions } from "./router";
import { RequestMethod } from "./mapping";
import { IOCContainer } from "koatty_container";
import { DefaultLogger as Logger } from "koatty_logger";
import { Handler, injectParamMetaData, injectRouter } from "./inject";
import {
  Koatty, KoattyContext, KoattyRouter,
  RouterImplementation
} from "koatty_core";
import { Helper } from "koatty_lib";
import { parsePath } from "../utils/path";
import { payload } from "./payload";

/**
 * WebsocketRouter Options
 *
 * @export
 * @interface WebsocketRouterOptions
 */
export interface WebsocketRouterOptions extends RouterOptions {
  prefix: string;
}

export class WebsocketRouter implements KoattyRouter {
  readonly protocol: string;
  options: WebsocketRouterOptions;
  router: KoaRouter;
  private routerMap: Map<string, RouterImplementation>;

  constructor(app: Koatty, options?: RouterOptions) {
    this.options = Object.assign({
      prefix: options.prefix
    }, options);
    this.router = new KoaRouter(this.options);
    this.routerMap = new Map();
    // payload middleware
    app.use(payload(this.options.payload));
  }

  /**
   * Set router
   * @param name 
   * @param impl 
   * @returns 
   */
  SetRouter(name: string, impl?: RouterImplementation) {
    if (Helper.isEmpty(impl.path)) {
      return;
    }
    const method = (impl.method || "").toLowerCase();
    switch (method) {
      case "get":
        this.router.get(impl.path, <any>impl.implementation);
        break;
      case "post":
        this.router.post(impl.path, <any>impl.implementation);
        break;
      case "put":
        this.router.put(impl.path, <any>impl.implementation);
        break;
      case "delete":
        this.router.delete(impl.path, <any>impl.implementation);
        break;
      case "patch":
        this.router.patch(impl.path, <any>impl.implementation);
        break;
      case "options":
        this.router.options(impl.path, <any>impl.implementation);
        break;
      case "head":
        this.router.head(impl.path, <any>impl.implementation);
        break;
      default:
        this.router.all(impl.path, <any>impl.implementation);
        break;
    }
    this.routerMap.set(name, impl);
  }

  /**
   * ListRouter
   *
   * @returns {*}  {Map<string, RouterImplementation> }
   */
  ListRouter(): Map<string, RouterImplementation> {
    return this.routerMap;
  }

  /**
   * LoadRouter
   *
   * @param {any[]} list
   */
  async LoadRouter(app: Koatty, list: any[]) {
    try {
      for (const n of list) {
        const ctlClass = IOCContainer.getClass(n, "CONTROLLER");
        // inject router
        const ctlRouters = injectRouter(app, ctlClass);
        // inject param
        const ctlParams = injectParamMetaData(app, ctlClass, this.options.payload);
        // tslint:disable-next-line: forin
        for (const it in ctlRouters) {
          const router = ctlRouters[it];
          const method = router.method;
          const path = parsePath(router.path);
          const requestMethod = <RequestMethod>router.requestMethod;
          const params = ctlParams[method];
          // websocket only handler get request
          if (requestMethod == RequestMethod.GET || requestMethod == RequestMethod.ALL) {
            Logger.Debug(`Register request mapping: [${requestMethod}] : ["${path}" => ${n}.${method}]`);
            this.SetRouter(path, {
              path,
              method: requestMethod,
              implementation: (ctx: KoattyContext): Promise<any> => {
                const ctl = IOCContainer.getInsByClass(ctlClass, [ctx]);
                return Handler(app, ctx, ctl, method, params);
              },
            });
          }
        }
      }
      // exp: in middleware
      // app.Router.SetRouter('/xxx',  (ctx: Koa.KoattyContext): any => {...}, 'GET')
      app.use(this.router.routes()).
        use(this.router.allowedMethods());
    } catch (err) {
      Logger.Error(err);
    }
  }

}
