/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-09 17:03:50
 * @LastEditTime: 2022-11-16 16:04:40
 */
import { CreateTerminus } from "../terminus";
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty, KoattyServer } from "koatty_core";
import {
  ChannelOptions, Server, ServerCredentials,
  ServiceDefinition, UntypedHandleCall
} from "@grpc/grpc-js";
import { ListeningOptions } from "../index";
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
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;

  constructor(app: Koatty, options: ListeningOptions) {
    this.app = app;
    this.protocol = options.protocol;
    this.options = options;
    options.ext = options.ext || {};
    this.options.channelOptions = Object.assign(this.options.channelOptions || {}, options.ext);
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
    listenCallback = listenCallback ? listenCallback : this.listenCallback;
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

    return this.server;
  }

  /**
   * Stop Server
   *
   */
  Stop(callback?: () => void) {
    this.server.tryShutdown((err?: Error) => {
      callback?.();
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