/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-28 14:47:26
 * @LastEditTime: 2021-06-28 17:55:45
 */
import { Koatty } from "koatty";
import { TraceServerSetup } from "koatty_trace";
import { Http } from "./http";
import { Http2 } from "./http2";
// export
export * from "./terminus";
/**
 *
 *
 * @export
 * @enum {number}
 */
export enum SERVE_MODE {
    "HTTP" = "http",
    "HTTP2" = "http2",
    "WEBSOCKET" = "websocket",
    "RPC" = "rpc"
}

/**
 * listening options
 *
 * @interface ListeningOptions
 */
export interface ListeningOptions {
    hostname: string;
    port: number;
    listenUrl: string;
    key?: string;
    cert?: string;
}

/**
 * interface Server
 *
 * @export
 * @interface Server
 */
export interface Server {
    Start: (openTrace: boolean, listenCallback: () => void) => void;
}

/**
 * Start Server
 *
 * @export
 * @param {SERVE_MODE} mode
 * @param {Koatty} app
 * @param {ListeningOptions} options
 * @param {() => void} listenCallback
 * @returns {*}  
 */
export function Serve(mode: SERVE_MODE, app: Koatty, options: ListeningOptions,
    listenCallback: () => void) {
    const openTrace = app.config("open_trace") ?? false;
    if (openTrace) {
        TraceServerSetup(app);
    }
    switch (mode) {
        case SERVE_MODE.HTTP2:
            return new Http2(app, options).Start(openTrace, listenCallback);
            break;
        case SERVE_MODE.HTTP:
        default:
            return new Http(app, options).Start(openTrace, listenCallback);
            break;
    }
}