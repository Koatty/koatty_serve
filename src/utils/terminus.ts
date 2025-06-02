/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-11-07 11:08:26
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import EventEmitter from "events";
import { KoattyServer } from "koatty_core";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";

/** @type {*} */
const terminusOptions = {
  signals: ["SIGINT", "SIGTERM", 'SIGQUIT'],
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
  opt.signals.forEach(event => {
    process.on(event, () => {
      opt.onSignal(event, server, opt.timeout).catch(err => Logger.Error(err));
    });
  });
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
  event.listeners(originEventName).forEach(func => {
    if (Helper.isFunction(func)) {
      process.addListener(<any>targetEventName, func);
    }
  });
  event.removeAllListeners(originEventName);
}

/**
 * Execute event as async
 *
 * @param {Koatty} event
 * @param {string} eventName
 */
const asyncEvent = async (event: EventEmitter, eventName: string) => {
  for (const func of event.listeners(eventName)) {
    if (Helper.isFunction(func)) {
      await func();
    }
  }
  return event.removeAllListeners(eventName);
};

/**
 * cleanup function, returning a promise (used to be onSigterm)
 *
 * @returns {*}  
 */
export async function onSignal(event: string, server: KoattyServer, forceTimeout: number) {
  Logger.Warn(`Received kill signal (${event}), shutting down...`);
  // Set status to service unavailable (if server has status property)
  (server as any).status = 503;
  await asyncEvent(process, 'beforeExit');
  // Don't bother with graceful shutdown in development
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
    return process.exit(0);
  }

  const forceShutdown = setTimeout(() => {
    Logger.Error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, forceTimeout);

  server.Stop(() => {
    clearTimeout(forceShutdown);
    Logger.Warn('Closed out remaining connections');
    process.exit(0);
  });
}
