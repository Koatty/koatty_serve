/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2023-12-09 23:12:15
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { KoattyContext } from "koatty_core";
import { injectParam } from "./inject";
import { PayloadOptions, bodyParser, queryParser } from "./payload";

/**
 * Get request header.
 *
 * @export
 * @param {string} [name]
 * @returns
 */
export function Header(name?: string): ParameterDecorator {
  return injectParam((ctx: KoattyContext) => {
    if (name !== undefined) {
      return ctx.get(name);
    }
    return ctx.headers;
  }, "Header");
}

/**
 * Get path variable (take value from ctx.params).
 *
 * @export
 * @param {string} [name] params name
 * @returns
 */
export function PathVariable(name?: string): ParameterDecorator {
  return injectParam((ctx: KoattyContext) => {
    const pathParams: any = ctx.params ?? {};
    if (name === undefined) {
      return pathParams;
    }
    return pathParams[name];
  }, "PathVariable");
}

/**
 * Get query-string parameters (take value from ctx.query).
 *
 * @export
 * @param {string} [name]
 * @returns
 */
export function Get(name?: string): ParameterDecorator {
  return injectParam((ctx: KoattyContext) => {
    const queryParams: any = ctx.query ?? {};
    if (name === undefined) {
      return queryParams;
    }
    return queryParams[name];
  }, "Get");
}

/**
 * Get parsed POST/PUT... body.
 *
 * @export
 * @param {string} [name]
 * @returns
 */
export function Post(name?: string): ParameterDecorator {
  return injectParam((ctx: KoattyContext, opt?: PayloadOptions) => {
    return bodyParser(ctx, opt).then((body: {
      post: Object
    }) => {
      const params: any = body.post ? body.post : body;
      if (name === undefined) {
        return params;
      }
      return params[name];
    });
  }, "Post");
}

/**
 * Get parsed upload file object.
 *
 * @export
 * @param {string} [name]
 * @returns
 */
export function File(name?: string): ParameterDecorator {
  return injectParam((ctx: KoattyContext, opt?: PayloadOptions) => {
    return bodyParser(ctx, opt).then((body: {
      file: Object
    }) => {
      const params: any = body.file ?? {};
      if (name === undefined) {
        return params;
      }
      return params[name];
    });
  }, "File");
}


/**
 * Get request body (contains the values of @Post and @File).
 *
 * @export
 * @returns
 */
export function RequestBody(): ParameterDecorator {
  return injectParam((ctx: KoattyContext, opt?: PayloadOptions) => {
    return bodyParser(ctx, opt);
  }, "RequestBody");
}

/**
 * Alias of @RequestBody
 * @param {*}
 * @return {*}
 */
export const Body = RequestBody;

/**
 * Get POST/GET parameters, POST priority
 *
 * @export
 * @param {string} [name]
 * @returns {ParameterDecorator}
 */
export function RequestParam(name?: string): ParameterDecorator {
  return injectParam((ctx: KoattyContext, opt?: PayloadOptions) => {
    return bodyParser(ctx, opt).then((body: {
      post: Object
    }) => {
      const queryParams: any = queryParser(ctx, opt) ?? {};
      const postParams: any = (body.post ? body.post : body) ?? {};
      if (name !== undefined) {
        return postParams[name] === undefined ? queryParams[name] : postParams[name];
      }
      return { ...queryParams, ...postParams };
    });
  }, "RequestParam");
}

/**
 * Alias of @RequestParam
 * @param {*}
 * @return {*}
 */
export const Param = RequestParam;
