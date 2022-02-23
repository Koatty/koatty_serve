/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 14:49:46
 * @LastEditTime: 2022-02-23 10:33:14
 */
import { createTerminus, TerminusOptions } from "@godaddy/terminus";
import EventEmitter from "events";
import { Server } from "http";
import { Http2SecureServer } from "http2";
import { DefaultLogger as Logger } from "koatty_logger";
import * as Helper from "koatty_lib";

/** @type {*} */
const defaultTerminusOptions = {
    // cleanup options
    timeout: 2000,                   // [optional = 1000] number of milliseconds before forceful exiting
    onSignal,                        // [optional] cleanup function, returning a promise (used to be onSigterm)
    onShutdown,                      // [optional] called right before exiting
    // both
    logger: Logger.Error                           // [optional] logger function to be called with errors. Example logger call: ('error happened during shutdown', error). See terminus.js for more details.
};

/**
 * Create terminus event
 *
 * @export
 * @param {(Server | Http2SecureServer)} server
 * @param {TerminusOptions} [options]
 */
export function CreateTerminus(server: Server | Http2SecureServer, options?: TerminusOptions): void {
    createTerminus(server, { ...defaultTerminusOptions, ...options });
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
export function onSignal() {
    Logger.Info('Server is starting cleanup');
    return asyncEvent(process, 'beforeExit');
}

/**
 * called right before exiting
 *
 * @returns {*}  
 */
export function onShutdown() {
    Logger.Info('Cleanup finished, server is shutting down');
    // todo Log report
    return asyncEvent(process, 'exit');
}