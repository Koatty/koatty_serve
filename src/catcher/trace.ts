/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 19:31:22
 * @LastEditTime: 2023-12-09 22:35:24
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
function getTraceId() {
  return uuidv4();
}

/**
 * Trace middleware
 *
 * @param {TraceOptions} options
 * @param {Koatty} app
 * @returns {*}  {Koa.Middleware}
 */
export function Trace(app: Koatty) {
  const timeout = (app.config('timeout') || 10) * 1000;
  const encoding = app.config('encoding') || 'utf-8';
  const openTrace = app.config("open_trace") || false;
  const asyncHooks = app.config("async_hooks") || false;
  const requestHeader = app.config("trace_header") || "X-Request-Id";
  const requestName = app.config("trace_id") || "requestId";

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
      ctx.setMetaData(requestName, requestId);

      if (ctx.protocol === "grpc") {
        // allow bypassing koa
        ctx.respond = false;
        ctx.rpc.call.metadata.set(requestName, requestId);
        await gRPCHandler(ctx, next, { timeout, requestId, encoding, terminated, span });
      } else if (ctx.protocol === "ws" || ctx.protocol === "wss") {
        // allow bypassing koa
        ctx.respond = false;
        ctx.set(requestHeader, requestId);
        await wsHandler(ctx, next, { timeout, requestId, encoding, terminated, span });
      } else {
        // response header
        ctx.set(requestHeader, requestId);
        await httpHandler(ctx, next, { timeout, requestId, encoding, terminated, span });
      }
      return respond(ctx);
    }

    let requestId = '';
    if (ctx.protocol === "grpc") {
      const request: any = ctx.getMetaData("_body")[0] || {};
      requestId = `${ctx.getMetaData(requestName)[0]}` || <string>request[requestName];
    } else {
      const requestIdHeaderName = requestHeader.toLowerCase();
      requestId = <string>ctx.headers[requestIdHeaderName] || <string>ctx.query[requestName];
    }
    requestId = requestId || getTraceId();
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