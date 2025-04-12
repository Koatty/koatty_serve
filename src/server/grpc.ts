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
import { KoattyApplication } from "koatty_core";
import { BaseServer, ListeningOptions } from "./base";
import { DefaultLogger as Logger } from "koatty_logger";
import { CreateTerminus } from "../utils/terminus";
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
  ext?: {
    key?: string;
    cert?: string;
    [key: string]: any;
  };
}

export class GrpcServer extends BaseServer<GrpcServerOptions> {
  readonly server: Server;

  constructor(app: KoattyApplication, options: GrpcServerOptions) {
    super(app, options);
    const opts = this.options as GrpcServerOptions;
    opts.ext = opts.ext || {};
    const channelOptions = {
      ...opts.channelOptions,
      ...opts.ext,
    };
    this.server = new Server(channelOptions);
    CreateTerminus(this);
  }

  protected async applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ) {
    this.options = { ...this.options, ...newConfig };
    
    if (changedKeys.includes('port') || changedKeys.includes('hostname')) {
      Logger.Info('Restarting server with new address configuration...');
      await this.Stop();
      // 添加微延迟确保服务完全关闭
      await new Promise(resolve => setTimeout(resolve, 100));
      this.Start(this.listenCallback);
    }
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
  Stop(callback?: (err?: Error) => void) {
    this.server.tryShutdown((err?: Error) => {
      if (err) {
        Logger.Error('Graceful shutdown failed, forcing shutdown:', err);
        this.server.forceShutdown();
        return;
      }
      if (callback) callback();
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
