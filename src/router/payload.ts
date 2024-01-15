/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:30:20
 * @LastEditTime: 2024-01-15 13:30:33
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import fs from "fs";
import { parse } from "querystring";
import util from "util";
import getRawBody from "raw-body";
import inflate from "inflation";
import { parseStringPromise } from "xml2js";
import { IncomingForm, BufferEncoding } from "formidable";
import { DefaultLogger as Logger } from "koatty_logger";
import onFinished from "on-finished";
import { KoattyContext, KoattyNext } from "koatty_core";
import { Helper } from "koatty_lib";
import { DefaultLogger as logger } from "koatty_logger";
const fsUnlink = util.promisify(fs.unlink);
const fsAccess = util.promisify(fs.access);
/**
 *
 *
 * @interface DefaultOptions
 */
export interface PayloadOptions {
  extTypes: {
    json: string[],
    form: string[],
    text: string[],
    multipart: string[],
    xml: string[],
  };
  limit: string;
  encoding: BufferEncoding;
  multiples: boolean;
  keepExtensions: boolean;
  length?: number;
}

/** @type {*} */
const defaultOptions: PayloadOptions = {
  extTypes: {
    json: ['application/json'],
    form: ['application/x-www-form-urlencoded'],
    text: ['text/plain'],
    multipart: ['multipart/form-data'],
    xml: ['text/xml']
  },
  limit: '20mb',
  encoding: 'utf-8',
  multiples: true,
  keepExtensions: true,
};

/**
 * @description: payload middleware
 * @param {PayloadOptions} options
 * @return {*}
 */
export function payload(options?: PayloadOptions) {
  return (ctx: KoattyContext, next: KoattyNext) => {
    Helper.define(ctx, "requestParam", () => {
      return queryParser(ctx, options);
    });
    Helper.define(ctx, "requestBody", () => {
      return bodyParser(ctx, options);
    });
    return next();
  }
}

/**
 * @description: 
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} options
 * @return {*}
 */
export function queryParser(ctx: KoattyContext, options?: PayloadOptions): any {
  let query = ctx.getMetaData("_query")[0];
  if (!Helper.isEmpty(query)) {
    return query;
  }
  query = { ...(ctx.query), ...(ctx.params || {}) };
  ctx.setMetaData("_query", query);
  return query;
}

/**
 * @description: 
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} options
 * @return {*}
 */
export async function bodyParser(ctx: KoattyContext, options?: PayloadOptions): Promise<any> {
  let body = ctx.getMetaData("_body")[0];
  if (!Helper.isEmpty(body)) {
    return body;
  }
  try {
    options = { ...defaultOptions, ...options };
    const res = await parseBody(ctx, options);
    body = res || {};
    ctx.setMetaData("_body", body);
    return body;
  } catch (err) {
    logger.Error(err);
    return {};
  }
}

/**
 * parseBody
 *
 * @export
 * @param {*} ctx
 * @param {*} options
 * @returns {*}  
 */
function parseBody(ctx: KoattyContext, options: PayloadOptions): Promise<unknown> {
  const methods = ['POST', 'PUT', 'DELETE', 'PATCH', 'LINK', 'UNLINK'];
  if (methods.every((method: string) => ctx.method !== method)) {
    return Promise.resolve({});
  }
  // defaults
  const len = ctx.req.headers['content-length'];
  const encoding = ctx.req.headers['content-encoding'] || 'identity';
  if (len && encoding === 'identity') {
    options.length = ~~len;
  }
  options.encoding = options.encoding || 'utf8';
  options.limit = options.limit || '1mb';

  if (ctx.request.is(options.extTypes.form)) {
    return parseForm(ctx, options);
  }
  if (ctx.request.is(options.extTypes.multipart)) {
    return parseMultipart(ctx, options);
  }
  if (ctx.request.is(options.extTypes.json)) {
    return parseJson(ctx, options);
  }
  if (ctx.request.is(options.extTypes.text)) {
    return parseText(ctx, options);
  }
  if (ctx.request.is(options.extTypes.xml)) {
    return parseXml(ctx, options);
  }

  return Promise.resolve({});
}


/**
 * parse form
 *
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} opts
 * @returns {*}  
 */
async function parseForm(ctx: KoattyContext, opts: PayloadOptions) {
  try {
    const str = await parseText(ctx, opts);
    const data = parse(str);
    return { post: data };
  } catch (error) {
    Logger.Error(error);
    return { post: {} };
  }
}

/**
 * parse multipart
 *
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} opts
 * @returns {*}  
 */
function parseMultipart(ctx: KoattyContext, opts: PayloadOptions) {

  const form = new IncomingForm({
    encoding: <BufferEncoding>opts.encoding,
    multiples: opts.multiples,
    keepExtensions: opts.keepExtensions,
  });

  let uploadFiles: any = null;
  onFinished(ctx.res, () => {
    if (!uploadFiles) {
      return;
    }
    Object.keys(uploadFiles).forEach((key: string) => {
      fsAccess(uploadFiles[key].path).then(() => fsUnlink(uploadFiles[key].path)).catch((err) => Logger.Error(err));
    });
  });
  return new Promise((resolve, reject) => {
    form.parse(ctx.req, function (err, fields, files) {
      if (err) {
        // return reject(err);
        Logger.Error(err);
        return resolve({ post: {}, file: {} });
      }
      uploadFiles = files;
      return resolve({
        post: fields,
        file: files
      });
    });
  });
}

/**
 * parse json
 *
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} opts
 * @returns {*}  
 */
async function parseJson(ctx: KoattyContext, opts: PayloadOptions) {
  try {
    const str = await parseText(ctx, opts);
    const data = JSON.parse(str);
    return { post: data };
  } catch (error) {
    Logger.Error(error);
    return { post: {} };
  }
}

/**
 * parse text
 *
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} opts
 * @returns {*}  {Promise<string>}
 */
function parseText(ctx: KoattyContext, opts: PayloadOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    getRawBody(inflate(ctx.req), opts, function (err: any, body: string) {
      if (err) {
        // reject(err);
        Logger.Error(err);
        return resolve("");
      }
      resolve(body);
    });
  });
}

/**
 * parse xml
 *
 * @param {KoattyContext} ctx
 * @param {PayloadOptions} opts
 * @returns {*}  
 */
async function parseXml(ctx: KoattyContext, opts: PayloadOptions) {
  try {
    const str = await parseText(ctx, opts);
    const data = await parseStringPromise(str);
    return { post: data };
  } catch (error) {
    Logger.Error(error);
    return { post: {} };
  }
}