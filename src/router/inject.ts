/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-01-03 20:28:59
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { Helper } from "koatty_lib";
import { Exception } from "koatty_exception";
import { Koatty, KoattyContext } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { getOriginMetadata, IOCContainer, RecursiveGetMetadata, TAGGED_PARAM } from "koatty_container";
import {
  ClassValidator, FunctionValidator, convertParamsType,
  PARAM_CHECK_KEY, PARAM_RULE_KEY, PARAM_TYPE_KEY,
  plainToClass, ValidRules, ValidOtpions, paramterTypes
} from "koatty_validation";
import { CONTROLLER_ROUTER, ROUTER_KEY } from "./mapping";
import { PayloadOptions } from "./payload";

/**
 * controller handler
 *
 * @param {Koatty} app
 * @param {KoattyContext} ctx
 * @param {*} ctl
 * @param {*} method
 * @param {*} ctlParams
 * @returns
 */
export async function Handler(app: Koatty, ctx: KoattyContext, ctl: any, method: string, ctlParams?: ParamMetadata[]) {
  if (!ctx || !ctl) {
    return ctx.throw(404, `Controller not found.`);
  }
  if (!ctl.ctx) {
    ctl.ctx = ctx;
  }
  // inject param
  let args = [];
  if (ctlParams) {
    args = await getParameter(app, ctx, ctlParams);
  }
  // method
  const res = await ctl[method](...args);
  ctx.body = ctx.body || res;
}

/**
 *
 *
 * @interface RouterMetadata
 */
interface RouterMetadata {
  method: string;
  path: string;
  requestMethod: string;
  routerName: string;
}

/**
 *
 *
 * @interface RouterMetadataObject
 */
interface RouterMetadataObject {
  [key: string]: RouterMetadata;
}

/**
 *
 *
 * @param {Koatty} app
 * @param {*} target
 * @param {*} [instance]
 * @returns {*} 
 */
export function injectRouter(app: Koatty, target: any, instance?: any): RouterMetadataObject {
  // Controller router path
  const metaDatas = IOCContainer.listPropertyData(CONTROLLER_ROUTER, target);
  let path = "";
  const identifier = IOCContainer.getIdentifier(target);
  if (metaDatas) {
    path = metaDatas[identifier] ?? "";
  }
  path = path.startsWith("/") || path === "" ? path : `/${path}`;

  const rmetaData = RecursiveGetMetadata(ROUTER_KEY, target);
  const router: RouterMetadataObject = {};
  // tslint:disable-next-line: forin
  for (const metaKey in rmetaData) {
    // Logger.Debug(`Register inject method Router key: ${metaKey} => value: ${JSON.stringify(rmetaData[metaKey])}`);
    //.sort((a, b) => b.priority - a.priority) 
    for (const val of rmetaData[metaKey]) {
      const tmp = {
        ...val,
        path: `${path}${val.path}`.replace("//", "/")
      };
      router[`${tmp.path}||${tmp.requestMethod}`] = tmp;
    }
  }

  return router;
}

/**
 *
 *
 * @interface ParamMetadata
 */
export interface ParamMetadata {
  "fn": Function;
  "name": string;
  "index": number;
  "clazz": any;
  "type": string;
  "isDto": boolean;
  "validRule": Function | ValidRules | ValidRules[];
  "validOpt": ValidOtpions;
  "options": PayloadOptions;
  "dtoCheck": boolean;
  "dtoRule": any;
}

/**
 *
 *
 * @interface ParamMetadataMap
 */
interface ParamMetadataMap {
  [key: string]: ParamMetadata[];
}

/**
 * injectParamMetaData
 *
 * @param {Koatty} app
 * @param {*} target
 * @param {*} [instance]
 * @returns {*} 
 */
export function injectParamMetaData(app: Koatty, target: any, instance?: any, options?: PayloadOptions): ParamMetadataMap {
  instance = instance || target.prototype;
  const metaDatas = RecursiveGetMetadata(TAGGED_PARAM, target);
  const validMetaDatas = RecursiveGetMetadata(PARAM_RULE_KEY, target);
  const validatedMetaDatas = RecursiveGetMetadata(PARAM_CHECK_KEY, target);
  const argsMetaObj: ParamMetadataMap = {};
  for (const meta in metaDatas) {
    // 实例方法带规则形参必须小于等于原型形参(如果不存在验证规则，则小于)
    if (instance[meta] && instance[meta].length <= metaDatas[meta].length) {
      Logger.Debug(`Register inject param key ${IOCContainer.getIdentifier(target)}: ${Helper.toString(meta)} => value: ${JSON.stringify(metaDatas[meta])}`);

      // cover to obj
      const data: ParamMetadata[] = (metaDatas[meta] ?? []).sort((a: ParamMetadata, b: ParamMetadata) => a.index - b.index);
      const validData = validMetaDatas[meta] ?? [];
      data.forEach((v: ParamMetadata) => {
        validData.forEach((it: any) => {
          if (v.index === it.index && it.name === v.name) {
            v.validRule = it.rule;
            v.validOpt = it.options;
          }
        });
        if (v.type) {
          v.type = v.isDto ? v.type : (v.type).toLowerCase();
        }
        v.dtoCheck = !!((validatedMetaDatas[meta]?.dtoCheck));
        if (v.isDto) {
          v.clazz = IOCContainer.getClass(v.type, "COMPONENT");
          if (v.dtoCheck) {
            v.dtoRule = {};
            const originMap = getOriginMetadata(PARAM_TYPE_KEY, v.clazz);
            for (const [key, type] of originMap) {
              v.dtoRule[key] = type;
            }
            v.clazz.prototype["_typeDef"] = v.dtoRule;
          }
        }
        v.options = options
      });
      argsMetaObj[meta] = data;
    }
  }
  return argsMetaObj;
}


/**
 * inject ParameterDecorator
 *
 * @param {Function} fn
 * @param {string} name
 * @returns {*}  {ParameterDecorator}
 */
export const injectParam = (fn: Function, name: string): ParameterDecorator => {
  return (target: Object, propertyKey: string, descriptor: number) => {
    const targetType = IOCContainer.getType(target);
    if (targetType !== "CONTROLLER") {
      throw Error(`${name} decorator is only used in controllers class.`);
    }
    // 获取成员类型
    // const type = Reflect.getMetadata("design:type", target, propertyKey);
    // 获取成员参数类型
    const paramTypes = Reflect.getMetadata("design:paramtypes", target, propertyKey);
    // 获取成员返回类型
    // const returnType = Reflect.getMetadata("design:returntype", target, propertyKey);
    // 获取所有元数据 key (由 TypeScript 注入)
    // const keys = Reflect.getMetadataKeys(target, propertyKey);
    let type = (paramTypes[descriptor]?.name) ? paramTypes[descriptor].name : 'object';
    let isDto = false;
    //DTO class
    if (!(Helper.toString(type) in paramterTypes)) {
      type = IOCContainer.getIdentifier(paramTypes[descriptor]);
      // reg to IOC container
      // IOCContainer.reg(type, paramTypes[descriptor]);
      isDto = true;
    }

    IOCContainer.attachPropertyData(TAGGED_PARAM, {
      name: propertyKey,
      fn,
      index: descriptor,
      type,
      isDto
    }, target, propertyKey);
    return descriptor;

  };
};


/**
 * Parameter binding assignment.
 *
 * @param {Koatty} app
 * @param {KoattyContext} ctx
 * @param {any[]} params
 * @returns
 */
async function getParameter(app: Koatty, ctx: KoattyContext, params?: ParamMetadata[]) {
  //convert type
  params = params || <ParamMetadata[]>[];
  const props: any[] = params.map(async (v: ParamMetadata, k: number) => {
    let value: any = null;
    if (v.fn && Helper.isFunction(v.fn)) {
      value = await v.fn(ctx, v.options);
    }

    // check params
    return checkParams(app, value, {
      index: k,
      isDto: v.isDto,
      type: v.type,
      validRule: v.validRule,
      validOpt: v.validOpt,
      dtoCheck: v.dtoCheck,
      dtoRule: v.dtoRule,
      clazz: v.clazz,
    });
  });
  return Promise.all(props);
}

/**
 *
 *
 * @interface ParamOptions
 */
interface ParamOptions {
  index: number;
  isDto: boolean;
  type: string;
  validRule: Function | ValidRules | ValidRules[];
  validOpt: ValidOtpions;
  dtoCheck: boolean;
  dtoRule: any;
  clazz: any;
}

/**
 * Parameter binding assignment and rule verification.
 * If the input parameter type is inconsistent with the calibration, 
 * it will cause the parameter type conversion
 *
 * @param {Koatty} app
 * @param {*} value
 * @param {ParamOptions} opt
 * @returns {*}  
 */
async function checkParams(app: Koatty, value: any, opt: ParamOptions) {
  try {
    //@Validated
    if (opt.isDto) {
      // DTO class
      if (!opt.clazz) {
        opt.clazz = IOCContainer.getClass(opt.type, "COMPONENT");
      }
      if (opt.dtoCheck) {
        value = await ClassValidator.valid(opt.clazz, value, true);
      } else {
        value = plainToClass(opt.clazz, value, true);
      }
    } else {
      // querystring default type is string, must be convert type
      value = convertParamsType(value, opt.type);
      //@Valid()
      if (opt.validRule) {
        validatorFuncs(`${opt.index}`, value, opt.type, opt.validRule, opt.validOpt);
      }
    }
    return value;
  } catch (err) {
    throw new Exception(err.message || `ValidatorError: invalid arguments.`, 1, 400);
  }
}


/**
 * Validated by funcs.
 *
 * @export
 * @param {string} name
 * @param {*} value
 * @param {string} type
 * @param {(ValidRules | ValidRules[] | Function)} rule
 * @param {ValidOtpions} [options]
 * @param {boolean} [checkType=true]
 * @returns
 */
function validatorFuncs(name: string, value: any, type: string,
  rule: ValidRules | ValidRules[] | Function, options?: ValidOtpions) {
  if (Helper.isFunction(rule)) {
    // Function no return value
    rule(value);
  } else {
    const funcs: any[] = [];
    if (Helper.isString(rule)) {
      funcs.push(rule);
    } else if (Helper.isArray(rule)) {
      funcs.push(...<any[]>rule);
    }
    for (const func of funcs) {
      if (Object.hasOwnProperty.call(FunctionValidator, func)) {
        // FunctionValidator just throws error, no return value
        FunctionValidator[<ValidRules>func](value, options);
      }
    }
  }
}
