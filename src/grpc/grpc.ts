/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-09 17:03:50
 * @LastEditTime: 2021-11-12 15:11:58
 */
import { ChannelOptions, Server, ServerCredentials, status } from "@grpc/grpc-js";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { onSignal } from "../terminus";

/**
 *
 *
 * @interface GrpcServiceImplementation
 */
export interface GrpcServiceImplementation {
    service: any;
    implementation: any;
}

/**
 *
 *
 * @export
 * @interface GrpcServerOptions
 * @extends {ListeningOptions}
 */
export interface GrpcServerOptions extends ListeningOptions {
    channelOptions?: ChannelOptions;
}

export class GrpcServer implements KoattyServer {
    app: Koatty;
    options: GrpcServerOptions;
    server: Server;
    status: status;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        options.ext = options.ext || {};
        this.options.channelOptions = Object.assign(this.options.channelOptions || {}, options.ext);
        this.server = new Server(this.options.channelOptions);
    }

    /**
     *
     *
     * @param {boolean} openTrace
     * @param {() => void} listenCallback
     * @memberof Grpc
     */
    Start(openTrace: boolean, listenCallback: () => void) {
        Logger.Debug("Protocol: gRPC");
        // Register Service
        const impls: Map<string, GrpcServiceImplementation> = this.app.router.ListRouter();
        for (const value of impls.values()) {
            this.RegisterService(value);
        }
        // key: this.options.ext.key,
        // cert: this.options.ext.cert,
        const creds = ServerCredentials.createInsecure();
        this.server.bindAsync(`${this.options.hostname}:${this.options.port}`, creds, () => {
            this.server.start();
            listenCallback();
        });
        process.on("beforeExit", (code: number) => {
            this.Stop();
        });
    }

    /**
     * Stop Server
     *
     */
    Stop() {
        onSignal();
        this.server.tryShutdown((err?: Error) => {
            Logger.Error(err);
        });
    }

    /**
     * RegisterService
     *
     * @param {GrpcServer} server
     * @param {ServiceImplementation} impl
     * @memberof Grpc
     */
    RegisterService(impl: GrpcServiceImplementation) {
        this.server.addService(impl.service, impl.implementation);
    }
}