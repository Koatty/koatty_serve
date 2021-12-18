/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-18 01:56:43
 * @LastEditTime: 2021-12-19 00:56:13
 */

import { Koatty, ListeningOptions } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
/**
 * Listening callback function
 *
 * @param {Koatty} app
 * @param {ListeningOptions} options
 * @returns {*} 
 */
export const listenCallback = (app: Koatty, options: ListeningOptions) => {
    return function () {
        Logger.Log("think", "", `Nodejs Version: ${process.version}`);
        Logger.Log("think", "", `Koatty Version: v${app.version}`);
        Logger.Log("think", "", `App Environment: ${app.env}`);
        Logger.Log("think", "", `Server running at ${options.protocol === "http2" ? "https" : options.protocol}://${options.hostname || '127.0.0.1'}:${options.port}/`);
        Logger.Log("think", "", "====================================");
        // tslint:disable-next-line: no-unused-expression
        app.appDebug && Logger.Warn(`Running in debug mode.`);
    };
};