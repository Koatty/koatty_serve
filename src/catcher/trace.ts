/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 19:31:22
 * @LastEditTime: 2023-12-09 20:30:42
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { v4 as uuidv4 } from "uuid";
import { FORMAT_HTTP_HEADERS, Span, Tags, Tracer } from "opentracing";
import { Koatty, KoattyContext, KoattyNext } from "koatty_core";
import { respond } from "./respond";
import { gRPCHandler } from "./grpc";
import { wsHandler } from "./ws";
import { httpHandler } from "./http";
import { asyncLocalStorage, createAsyncResource, wrapEmitter } from "./wrap";

/**
 * GetTraceId
 *
 * @export
 * @returns {*}  
 */
function getTraceId(options?: TraceOptions) {
  const rid = options?.IdFactory()
  return rid || uuidv4();
}

/**
 * TraceOptions
 *
 * @export
 * @interface TraceOptions
 */
export interface TraceOptions {
  RequestIdHeaderName: string;
  RequestIdName: string;
  IdFactory: any;
}

/** 
 * defaultOptions
 */
const defaultOptions = {
  RequestIdHeaderName: 'X-Request-Id',
  RequestIdName: "requestId",
  IdFactory: uuidv4,
};

/**
 * Trace middleware
 *
 * @param {TraceOptions} options
 * @param {Koatty} app
 * @returns {*}  {Koa.Middleware}
 */
export function Trace(options: TraceOptions, app: Koatty) {
  options = { ...defaultOptions, ...options };
  const timeout = (app.config('http_timeout') || 10) * 1000;
  const encoding = app.config('encoding') || 'utf-8';
  const openTrace = app.config("open_trace") || false;
  const asyncHooks = app.config("async_hooks") || false;

  // 
  let tracer: Tracer;
  if (openTrace) {
    tracer = app.getMetaData("tracer")[0];
    if (!tracer) {
      tracer = new Tracer();
    }
  }

  return async (ctx: KoattyContext, next: KoattyNext) => {
    // server terminated
    let terminated = false;
    if (app.server.status === 503) {
      ctx.status = 503;
      ctx.set('Connection', 'close');
      ctx.body = 'Server is in the process of shutting down';
      terminated = true;
    }
    // 
    const respWapper = async (requestId: string, span?: Span) => {
      // metadata
      ctx.setMetaData(options.RequestIdName, requestId);

      if (ctx.protocol === "grpc") {
        // allow bypassing koa
        ctx.respond = false;
        ctx.rpc.call.metadata.set(options.RequestIdName, requestId);
        await gRPCHandler(ctx, next, { timeout, requestId, encoding, terminated, span });
      } else if (ctx.protocol === "ws" || ctx.protocol === "wss") {
        // allow bypassing koa
        ctx.respond = false;
        ctx.set(options.RequestIdHeaderName, requestId);
        await wsHandler(ctx, next, { timeout, requestId, encoding, terminated, span });
      } else {
        // response header
        ctx.set(options.RequestIdHeaderName, requestId);
        await httpHandler(ctx, next, { timeout, requestId, encoding, terminated, span });
      }
      return respond(ctx);
    }

    let requestId = '';
    if (ctx.protocol === "grpc") {
      const request: any = ctx.getMetaData("_body")[0] || {};
      requestId = `${ctx.getMetaData(options.RequestIdName)[0]}` || <string>request[options.RequestIdName];
    } else {
      const requestIdHeaderName = options.RequestIdHeaderName.toLowerCase();
      requestId = <string>ctx.headers[requestIdHeaderName] || <string>ctx.query[options.RequestIdName];
    }
    requestId = requestId || getTraceId(options);
    let span: Span;
    if (openTrace) {
      const serviceName = app.name || "unknownKoattyProject";
      const wireCtx = tracer.extract(FORMAT_HTTP_HEADERS, ctx.req.headers);
      if (wireCtx != null) {
        span = tracer.startSpan(serviceName, { childOf: wireCtx });
      } else {
        span = tracer.startSpan(serviceName);
      }
      span.addTags({ requestId });
      ctx.setMetaData("tracer_span", span);
    }
    if (asyncHooks) {
      return asyncLocalStorage.run(requestId, () => {
        const asyncResource = createAsyncResource();
        wrapEmitter(ctx.req, asyncResource);
        wrapEmitter(ctx.res, asyncResource);
        return respWapper(requestId, span);
      });
    }
    return respWapper(requestId);
  }
}