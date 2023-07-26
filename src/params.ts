/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-24 23:21:26
 * @LastEditTime: 2023-02-17 14:21:38
 */
import { IOCContainer } from "koatty_container";
import { Koatty, KoattyContext } from "koatty_core";
import { Exception } from "koatty_exception";
import * as Helper from "koatty_lib";
import {
  ClassValidator, FunctionValidator, convertParamsType,
  plainToClass, ValidRules, ValidOtpions, checkParamsType
} from "koatty_validation";
import { ParamMetadata } from "./inject";

/**
 * Parameter binding assignment.
 *
 * @param {Koatty} app
 * @param {KoattyContext} ctx
 * @param {any[]} params
 * @returns
 */
export async function getParameter(app: Koatty, ctx: KoattyContext, params?: ParamMetadata[]) {
  //convert type
  params = params || <ParamMetadata[]>[];
  const props: any[] = params.map(async (v: ParamMetadata, k: number) => {
    let value: any = null;
    if (v.fn && Helper.isFunction(v.fn)) {
      value = await v.fn(ctx);
    }

    // check params
    return checkParams(app, value, {
      index: k,
      isDto: v.isDto,
      type: v.type,
      validRule: v.rule,
      validOpt: v.options,
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
      // querystring must be convert type
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
