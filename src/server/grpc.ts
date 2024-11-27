/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-09 17:03:50
 * @LastEditTime: 2024-11-27 17:24:54
 */
import {
  ChannelOptions, Server, ServerCredentials,
  ServiceDefinition, UntypedHandleCall
} from "@grpc/grpc-js";
import { KoattyApplication, KoattyServer } from "koatty_core";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListeningOptions } from "../index";
import { CreateTerminus } from "../terminus";
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
  options: GrpcServerOptions;
  readonly server: Server;
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;

  constructor(app: KoattyApplication, options: ListeningOptions) {
    this.protocol = options.protocol;
    this.options = options;
    options.ext = options.ext || {};
    this.options.channelOptions = {
      ...this.options.channelOptions,
      ...options.ext,
    };
    this.server = new Server(this.options.channelOptions);
    CreateTerminus(this);
  }

  /**
   * Start Server
   *
   * @param {() => void} listenCallback
   * @memberof Grpc
   */
  Start(listenCallback?: () => void): Server {
    const finalCallback = listenCallback || this.listenCallback;
    const credentials = ServerCredentials.createInsecure();
    // key: this.options.ext.key,
    // cert: this.options.ext.cert,
    // const credentials = ServerCredentials.createSsl(
    //     Buffer.from(this.options.ext.cert),
    //     [],
    // );
    this.server.bindAsync(`${this.options.hostname}:${this.options.port}`, credentials, () => {
      // this.server.start();
      finalCallback?.();
    });

    return this.server;
  }

  /**
   * Stop Server
   *
   */
  Stop(callback?: () => void) {
    this.server.tryShutdown((err?: Error) => {
      if (callback) callback();
      if (err) Logger.Error(err);
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