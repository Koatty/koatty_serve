/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2022-02-21 11:32:03
 * @LastEditTime: 2023-11-10 22:16:15
 */

import { IOCContainer } from "koatty_container";
import { KoattyContext } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { Exception, isException } from "koatty_exception";
import { Helper } from "koatty_lib";
import { Span, Tags } from "opentracing";

/**
* Global Error handler
*
* @template T
* @param {KoattyContext} ctx
* @param {(Exception | T)} err
*/
export function catcher<T extends Exception>(ctx: KoattyContext, err: Error | Exception | T) {
  // LOG
  Logger.Error(err.stack);

  const span = <Span>ctx.getMetaData("tracer_span")[0];
  if (span) {
    span.setTag(Tags.ERROR, true);
    span.setTag(Tags.HTTP_STATUS_CODE, (<T>err).status || 500);
    span.log({ 'event': 'error', 'error.object': err, 'message': err.message, 'stack': err.stack });
  }
  // 执行错误处理
  if (isException(err) && Helper.isFunction((<any>err).handler)) {
    return (<any>err).handler(ctx);
  }
  // 查找全局错误处理
  const globalErrorHandler: any = IOCContainer.getClass("ExceptionHandler", "COMPONENT");
  const message = (err.message).includes('"') ? (err.message).replaceAll('"', '\\"') : err.message;
  if (globalErrorHandler) {
    return new globalErrorHandler(message, (<T>err).code ?? 1, (<T>err).status || 500).handler(ctx);
  }

  // 使用默认错误处理
  return new Exception(message, (<T>err).code ?? 1, (<T>err).status || 500).default(ctx);
}
