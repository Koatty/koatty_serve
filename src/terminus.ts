/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 14:49:46
 * @LastEditTime: 2022-11-16 17:41:03
 */
import EventEmitter from "events";
import { DefaultLogger as Logger } from "koatty_logger";
import * as Helper from "koatty_lib";
import { KoattyServer } from "koatty_core";

/** @type {*} */
const terminusOptions = {
  signals: ["SIGINT", "SIGTERM"],
  // cleanup options
  timeout: 60000,                   // [optional = 1000] number of milliseconds before forceful exiting
  onSignal,                        // [optional] cleanup function, returning a promise (used to be onSigterm)
};

export interface TerminusOptions {
  timeout: number;
  signals?: string[];
  onSignal?: (event: string, server: KoattyServer, forceTimeout: number) => Promise<any>;
}

/**
 * Create terminus event
 *
 * @export
 * @param {(Server | Http2SecureServer)} server
 * @param {TerminusOptions} [options]
 */
export function CreateTerminus(server: KoattyServer, options?: TerminusOptions): void {
  const opt = { ...terminusOptions, ...options };
  for (const event of opt.signals) {
    process.on(event, () => {
      opt.onSignal(event, server, opt.timeout);
    })
  }
}
// processEvent
type processEvent = "beforeExit" | "exit" | NodeJS.Signals;
/**
 * Bind event to the process
 *
 * @param {EventEmitter} event
 * @param {string} originEventName
 * @param {string} [targetEventName]
 */
export function BindProcessEvent(event: EventEmitter, originEventName: string, targetEventName: processEvent = "beforeExit") {
  const ls: Function[] = event.listeners(originEventName);
  for (const func of ls) {
    if (Helper.isFunction(func)) {
      process.addListener(<any>targetEventName, func);
    }
  }
  return event.removeAllListeners(originEventName);
}

/**
 * Execute event as async
 *
 * @param {Koatty} event
 * @param {string} eventName
 */
const asyncEvent = async function (event: EventEmitter, eventName: string) {
  const ls: any[] = event.listeners(eventName);
  // eslint-disable-next-line no-restricted-syntax
  for await (const func of ls) {
    if (Helper.isFunction(func)) {
      func();
    }
  }
  return event.removeAllListeners(eventName);
};

/**
 * cleanup function, returning a promise (used to be onSigterm)
 *
 * @returns {*}  
 */
async function onSignal(event: string, server: KoattyServer, forceTimeout: number) {
  Logger.Warn(`Received kill signal (${event}), shutting down...`);
  server.status = 503;
  await asyncEvent(process, 'beforeExit');
  // Don't bother with graceful shutdown in development
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
    return process.exit(0);
  }

  setTimeout(() => {
    Logger.Error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, forceTimeout);

  server.Stop(() => {
    Logger.Warn('Closed out remaining connections');
    process.exit(0);
  });
}
