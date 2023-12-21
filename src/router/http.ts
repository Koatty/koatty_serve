/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 19:02:06
 * @LastEditTime: 2023-12-09 15:15:05
 */
import KoaRouter from "@koa/router";
import * as Helper from "koatty_lib";
import { RouterOptions } from "./router";
import { IOCContainer } from "koatty_container";
import { DefaultLogger as Logger } from "koatty_logger";
import { Handler, injectParamMetaData, injectRouter } from "./inject";
import { RequestMethod } from "./mapping";
import { Koatty, KoattyContext, KoattyNext, KoattyRouter } from "koatty_core";

// HttpImplementation
export type HttpImplementation = (ctx: KoattyContext, next: KoattyNext) => Promise<any>;

/**
 * HttpRouter class
 */
export class HttpRouter implements KoattyRouter {
  app: Koatty;
  readonly protocol: string;
  options: RouterOptions;
  router: KoaRouter;

  constructor(app: Koatty, options?: RouterOptions) {
    this.app = app;
    this.options = {
      ...options
    };
    // initialize
    this.router = new KoaRouter(this.options);
  }

  /**
   * Set router
   *
   * @param {string} path
   * @param {RequestMethod} [method]
   */
  SetRouter(path: string, func: HttpImplementation, method?: RequestMethod) {
    if (Helper.isEmpty(method)) {
      return;
    }
    method = method ?? RequestMethod.ALL;
    this.router[method](path, func);
  }

  /**
   * ListRouter
   *
   * @returns {*}  {KoaRouter.Middleware<any, unknown>}
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
          const path = router.path;
          const requestMethod = <RequestMethod>router.requestMethod;
          const params = ctlParams[method];
          Logger.Debug(`Register request mapping: ["${path}" => ${n}.${method}]`);
          this.SetRouter(path, (ctx: KoattyContext): Promise<any> => {
            const ctl = IOCContainer.getInsByClass(ctlClass, [ctx]);
            return Handler(this.app, ctx, ctl, method, params);
          }, requestMethod);
        }
      }

      // exp: in middleware
      // app.Router.SetRouter('/xxx',  (ctx: Koa.KoattyContext): any => {...}, 'GET')
      this.app.use(this.ListRouter()).
        use(this.router.allowedMethods());
    } catch (err) {
      Logger.Error(err);
    }
  }
}
