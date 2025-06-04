/*
 * @Description: configuration
 * @Usage: configuration
 * @Author: richen
 * @Date: 2024-11-27 21:30:00
 * @LastEditTime: 2024-11-27 21:30:00
 */
import * as WS from 'ws';
import { ChannelOptions } from "@grpc/grpc-js";
import { ConnectionPoolConfig } from "./pool";

// KoattyProtocol
export type KoattyProtocol = 'http' | "https" | 'http2' | 'grpc' | 'ws' | 'wss';

/**
 * 基础SSL配置
 */
export interface BaseSSLConfig {
  key?: string;                             // Private key file path or content
  cert?: string;                            // Certificate file path or content
  ca?: string;                              // CA certificate file path or content
  passphrase?: string;                      // Private key passphrase
  ciphers?: string;                         // Allowed cipher suites
  honorCipherOrder?: boolean;               // Honor cipher order
  secureProtocol?: string;                  // SSL/TLS protocol version
}

/**
 * gRPC和WebSocket使用的简单SSL配置
 */
export interface SSLConfig extends BaseSSLConfig {
  enabled: boolean;
  keyFile?: string;
  certFile?: string;
  caFile?: string;
  clientCertRequired?: boolean;
}

/**
 * HTTPS使用的高级SSL配置
 */
export interface SSL1Config extends BaseSSLConfig {
  mode: 'auto' | 'manual' | 'mutual_tls';  // SSL mode
  requestCert?: boolean;                    // Request client certificate
  rejectUnauthorized?: boolean;             // Reject unauthorized connections
}

/**
 * HTTP/2使用的SSL配置（支持HTTP/1.1降级）
 */
export interface SSL2Config extends SSL1Config {
  allowHTTP1?: boolean;                     // Allow HTTP/1.1 fallback
}

/**
 * listening options
 *
 * @interface ListeningOptions
 */
export interface ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol | KoattyProtocol[]; // 支持单协议或协议数组
  trace?: boolean; // Full stack debug & trace, default: false
  ext?: Record<string, any>; // Other extended configuration
  connectionPool?: ConnectionPoolConfig;
}

/**
 * Base Server Options
 *
 * @export
 * @interface BaseServerOptions
 * @extends {ListeningOptions}
 */
export interface BaseServerOptions extends ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol; // 支持单协议或协议数组
  trace?: boolean; // Full stack debug & trace, default: false
  ext?: Record<string, any>; // Other extended configuration
  connectionPool?: ConnectionPoolConfig;
}
/**
 * HTTP Server Options extending base options
 */
export interface HttpServerOptions extends BaseServerOptions {
  connectionPool?: ConnectionPoolConfig;
}

/**
 * Enhanced HTTPS Server Options
 */
export interface HttpsServerOptions extends BaseServerOptions {
  ssl?: SSL1Config;
  connectionPool?: ConnectionPoolConfig;
  ext?: {
    key?: string;
    cert?: string;
    ca?: string;
    [key: string]: any;
  };
}

/**
 * Enhanced HTTP/2 Server Options
 */
export interface Http2ServerOptions extends BaseServerOptions {
  ssl?: SSL2Config;
  http2?: {
    maxHeaderListSize?: number;
    maxSessionMemory?: number;
    settings?: {
      headerTableSize?: number;
      enablePush?: boolean;
      maxConcurrentStreams?: number;
      initialWindowSize?: number;
      maxFrameSize?: number;
      maxHeaderListSize?: number;
    };
  };
  connectionPool?: ConnectionPoolConfig;
  ext?: {
    key?: string;
    cert?: string;
    ca?: string;
    [key: string]: any;
  };
}

/**
 * WebSocket Server Options extending base options
 */
export interface WebSocketServerOptions extends BaseServerOptions {
  wsOptions?: WS.ServerOptions;
  ssl?: SSLConfig;
  connectionPool?: ConnectionPoolConfig;
}

/**
 * gRPC Server Options with enhanced configuration
 *
 * @export
 * @interface GrpcServerOptions
 * @extends {ListeningOptions}
 */
export interface GrpcServerOptions extends BaseServerOptions {
  channelOptions?: ChannelOptions;
  ssl?: SSLConfig;
  connectionPool?: ConnectionPoolConfig;
  ext?: {
    key?: string;
    cert?: string;
    ca?: string;
    [key: string]: any;
  };
}

export class ConfigHelper {
  static createHttpConfig(options: {
    hostname?: string;
    port?: number;
    protocol?: KoattyProtocol;
    trace?: boolean;
    ext?: Record<string, any>;
    connectionPool?: ConnectionPoolConfig;
  } = {}): HttpServerOptions {
    return {
      ...options,
      connectionPool: {
        ...options.connectionPool,
        maxConnections: options.connectionPool?.maxConnections || 1000,
        connectionTimeout: options.connectionPool?.connectionTimeout || 30000,
        keepAliveTimeout: options.connectionPool?.keepAliveTimeout || 5000,
        requestTimeout: options.connectionPool?.requestTimeout || 30000,
        headersTimeout: options.connectionPool?.headersTimeout || 10000
      },
      hostname: options.hostname || 'localhost',
      port: options.port || 3000,
      protocol: options.protocol || 'http',
      trace: options.trace || false,
      ext: options.ext || {}
    }
  }

  static createHttpsConfig(options: {
    hostname?: string;
    port?: number;
    protocol?: KoattyProtocol;
    trace?: boolean;
    ssl?: SSL1Config;
    ext?: Record<string, any>;
    connectionPool?: ConnectionPoolConfig;
  } = {}): HttpsServerOptions {
    return {
      ...options,
      connectionPool: {
        ...options.connectionPool,
        maxConnections: options.connectionPool?.maxConnections || 1000,
        connectionTimeout: options.connectionPool?.connectionTimeout || 30000,
        keepAliveTimeout: options.connectionPool?.keepAliveTimeout || 5000,
        requestTimeout: options.connectionPool?.requestTimeout || 30000,
        headersTimeout: options.connectionPool?.headersTimeout || 10000
      },
      ssl: {
        ...options.ssl,
        key: options.ext?.key || '',
        cert: options.ext?.cert || '',
        ca: options.ext?.ca || ''
      },
      hostname: options.hostname || 'localhost',
      port: options.port || 443,
      protocol: options.protocol || 'https',
      trace: options.trace || false,
      ext: options.ext || {}
    }
  }

  static createHttp2Config(options: {
    hostname?: string;
    port?: number;
    protocol?: KoattyProtocol;
    trace?: boolean;
    ssl?: SSL2Config;
    ext?: Record<string, any>;
    connectionPool?: ConnectionPoolConfig;
  } = {}): Http2ServerOptions {
    return {
      ...options,
      connectionPool: {
        ...options.connectionPool,
        maxConnections: options.connectionPool?.maxConnections || 1000,
        connectionTimeout: options.connectionPool?.connectionTimeout || 30000,
        keepAliveTimeout: options.connectionPool?.keepAliveTimeout || 5000,
        requestTimeout: options.connectionPool?.requestTimeout || 30000,
        headersTimeout: options.connectionPool?.headersTimeout || 10000
      },
      ssl: {
        ...options.ssl,
        key: options.ext?.key || '',
        cert: options.ext?.cert || '',
        ca: options.ext?.ca || ''
      },
      hostname: options.hostname || 'localhost',
      port: options.port || 443,
      protocol: options.protocol || 'http2',
      trace: options.trace || false,
      ext: options.ext || {}
    }
  }

  static createGrpcConfig(options: {
    hostname?: string;
    port?: number;
    protocol?: KoattyProtocol;
    trace?: boolean;
    ssl?: SSLConfig;
    ext?: Record<string, any>;
    connectionPool?: ConnectionPoolConfig;
  } = {}): GrpcServerOptions {
    // 处理gRPC特定的连接池配置
    const connectionPool: ConnectionPoolConfig = {
      ...options.connectionPool,
      maxConnections: options.connectionPool?.maxConnections || 1000,
      connectionTimeout: options.connectionPool?.connectionTimeout || 30000,
      protocolSpecific: {
        ...options.connectionPool?.protocolSpecific,
        // gRPC特定的配置
        keepAliveTime: (options.connectionPool?.protocolSpecific as any)?.keepAliveTime || 30000,
        maxReceiveMessageLength: (options.connectionPool?.protocolSpecific as any)?.maxReceiveMessageLength || 4 * 1024 * 1024,
        maxSendMessageLength: (options.connectionPool?.protocolSpecific as any)?.maxSendMessageLength || 4 * 1024 * 1024
      }
    };

    return {
      ...options,
      connectionPool,
      hostname: options.hostname || 'localhost',
      port: options.port || 50051, // gRPC默认端口
      protocol: options.protocol || 'grpc',
      trace: options.trace || false,
      ext: options.ext || {}
    }
  }

  static createWebSocketConfig(options: {
    hostname?: string;
    port?: number;
    protocol?: KoattyProtocol;
    trace?: boolean;
    ssl?: SSLConfig;
    ext?: Record<string, any>;
    connectionPool?: ConnectionPoolConfig;
  } = {}): WebSocketServerOptions {
    return {
      ...options,
      connectionPool: {
        ...options.connectionPool,
        maxConnections: options.connectionPool?.maxConnections || 1000,
        pingInterval: options.connectionPool?.pingInterval || 10000,
        pongTimeout: options.connectionPool?.pongTimeout || 5000,
        heartbeatInterval: options.connectionPool?.heartbeatInterval || 30000
      },
      ssl: {
        ...options.ssl,
        enabled: options.ssl?.enabled || false,
        keyFile: options.ext?.keyFile || '',
        certFile: options.ext?.certFile || '',
        caFile: options.ext?.caFile || '',
        clientCertRequired: options.ssl?.clientCertRequired || false
      },
      hostname: options.hostname || 'localhost',
      port: options.port || 8080,
      protocol: options.protocol || 'ws',
      trace: options.trace || false,
      ext: options.ext || {}
    }
  }
}
