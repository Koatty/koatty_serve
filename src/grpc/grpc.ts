/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-09 17:03:50
 * @LastEditTime: 2021-12-18 23:42:56
 */
import { ChannelOptions, Server, ServerCredentials, ServiceDefinition, UntypedHandleCall } from "@grpc/grpc-js";
import { Koatty, KoattyServer, ListeningOptions } from "koatty_core";
import { GrpcStatusCode } from "koatty_exception";
import { DefaultLogger as Logger } from "koatty_logger";
import { listenCallback } from "../callback";
import { onSignal } from "../terminus";

/**
 * ServiceImplementation
 *
 * @interface ServiceImplementation
 */
interface ServiceImplementation {
    service: ServiceDefinition;
    implementation: Implementation;
}
/**
 * Implementation
 *
 * @interface Implementation
 */
interface Implementation {
    [methodName: string]: UntypedHandleCall;
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
    readonly server: Server;
    status: GrpcStatusCode;
    callback: () => void;

    constructor(app: Koatty, options: ListeningOptions) {
        this.app = app;
        this.options = options;
        this.callback = listenCallback(app, options);
        options.ext = options.ext || {};
        this.options.channelOptions = Object.assign(this.options.channelOptions || {}, options.ext);
        this.server = new Server(this.options.channelOptions);
    }

    /**
     * Start Server
     *
     * @param {() => void} listenCallback
     * @memberof Grpc
     */
    Start(listenCallback: () => void) {
        Logger.Debug("Protocol: gRPC");
        listenCallback = listenCallback || this.callback;
        // Register gRPC Service
        const impls: Map<string, ServiceImplementation> = this.app.router.ListRouter();
        for (const value of impls.values()) {
            this.RegisterService(value);
        }
        const creds = ServerCredentials.createInsecure();
        // key: this.options.ext.key,
        // cert: this.options.ext.cert,
        // const creds = ServerCredentials.createSsl(
        //     Buffer.from(this.options.ext.cert),
        //     [],
        // );
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
    RegisterService(impl: ServiceImplementation) {
        this.server.addService(impl.service, impl.implementation);
    }
}