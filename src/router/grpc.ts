/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-29 14:10:30
 * @LastEditTime: 2024-01-15 22:39:07
 */
import * as Helper from "koatty_lib";
import { RouterOptions } from "./router";
import { parsePath } from "../utils/path";
import { IOCContainer } from "koatty_container";
import { ListServices, LoadProto } from "koatty_proto";
import { DefaultLogger as Logger } from "koatty_logger";
import { Handler, injectParamMetaData, injectRouter, ParamMetadata } from "./inject";
import { UntypedHandleCall } from "@grpc/grpc-js";
import {
  Koatty, KoattyRouter, IRpcServerUnaryCall,
  IRpcServerCallback, RouterImplementation
} from "koatty_core";
import { payload } from "./payload";

/**
 * GrpcRouter Options
 *
 * @export
 * @interface GrpcRouterOptions
 */
export interface GrpcRouterOptions extends RouterOptions {
  protoFile: string;
}

/**
 * CtlInterface
 *
 * @interface CtlInterface
 */
interface CtlInterface {
  [path: string]: CtlProperty
}
/**
 * CtlProperty
 *
 * @interface CtlProperty
 */
interface CtlProperty {
  name: string;
  ctl: Function;
  method: string;
  params: ParamMetadata[];
}

export class GrpcRouter implements KoattyRouter {
  readonly protocol: string;
  options: GrpcRouterOptions;
  router: Map<string, RouterImplementation>;

  constructor(app: Koatty, options?: RouterOptions) {
    options.ext = options.ext || {};
    this.options = {
      ...options,
      protoFile: options.ext.protoFile,
    };
    this.router = new Map();
    // payload middleware
    app.use(payload(this.options.payload));
  }

  /**
   * SetRouter
   * @param name 
   * @param impl 
   * @returns 
   */
  SetRouter(name: string, impl?: RouterImplementation) {
    if (Helper.isEmpty(name)) {
      return;
    }
    const value = {
      service: impl.service,
      implementation: impl.implementation
    }
    this.router.set(name, value);
  }

  /**
   * ListRouter
   *
   * @returns {*}  {Map<string, ServiceImplementation>}
   * @memberof GrpcRouter
   */
  ListRouter(): Map<string, RouterImplementation> {
    return this.router;
  }

  /**
   * LoadRouter
   *
   * @memberof Router
   */
  async LoadRouter(app: Koatty, list: any[]) {
    try {
      // load proto files
      const pdef = LoadProto(this.options.protoFile);
      const services = ListServices(pdef);

      const ctls: CtlInterface = {};
      for (const n of list) {
        const ctlClass = IOCContainer.getClass(n, "CONTROLLER");
        // inject router
        const ctlRouters = injectRouter(app, ctlClass);
        // inject param
        const ctlParams = injectParamMetaData(app, ctlClass, this.options.payload);

        for (const it in ctlRouters) {
          const router = ctlRouters[it];
          const method = router.method;
          const path = router.path;
          const params = ctlParams[method];

          ctls[path] = {
            name: n,
            ctl: ctlClass,
            method,
            params,
          }
        }
      }

      // 循环匹配服务绑定路由
      for (const si of services) {
        const serviceName = si.name;
        // Verifying
        if (!si.service || si.handlers.length === 0) {
          Logger.Warn('Ignore', serviceName, 'which is an empty service');
          return;
        }
        const impl: { [key: string]: UntypedHandleCall } = {};
        for (const handler of si.handlers) {
          const path = parsePath(handler.path);
          if (ctls[path]) {
            const ctlItem = ctls[path];
            Logger.Debug(`Register request mapping: ["${path}" => ${ctlItem.name}.${ctlItem.method}]`);
            impl[handler.name] = (call: IRpcServerUnaryCall<any, any>, callback: IRpcServerCallback<any>) => {
              return app.callback("grpc", (ctx) => {
                const ctl = IOCContainer.getInsByClass(ctlItem.ctl, [ctx]);
                return Handler(app, ctx, ctl, ctlItem.method, ctlItem.params);
              })(call, callback);
            };
          }
        }
        // set router
        this.SetRouter(serviceName, {
          service: si.service, implementation: impl
        });
        app?.server?.RegisterService({
          service: si.service,
          implementation: impl
        });
      }

    } catch (err) {
      Logger.Error(err);
    }
  }

}