import { KoattyApplication } from "koatty_core";
import {
  KoattyProtocol,
  ListeningOptions,
  BaseServerOptions,
  HttpServerOptions,
  HttpsServerOptions,
  Http2ServerOptions,
  WebSocketServerOptions,
  GrpcServerOptions,
  ConfigHelper,
  SSLConfig,
  SSL1Config,
  SSL2Config
} from "../../src/config/config";
// Mock KoattyApplication
class MockKoattyApplication {
  config(key?: string, defaultValue?: any) {
    return defaultValue;
  }
}

describe("Config", () => {
  let app: KoattyApplication;

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
  });
  
  describe("Type Definitions", () => {
    it("should define KoattyProtocol type correctly", () => {
      const protocols: KoattyProtocol[] = ['http', 'https', 'http2', 'grpc', 'ws', 'wss'];
      expect(protocols).toHaveLength(6);
    });

    it("should create valid ListeningOptions", () => {
      const options: ListeningOptions = {
        hostname: "localhost",
        port: 3000,
        protocol: "http"
      };
      expect(options.hostname).toBe("localhost");
      expect(options.port).toBe(3000);
      expect(options.protocol).toBe("http");
    });

    it("should support multiple protocols in ListeningOptions", () => {
      const options: ListeningOptions = {
        hostname: "localhost",
        port: 3000,
        protocol: ["http", "https"]
      };
      expect(Array.isArray(options.protocol)).toBe(true);
      expect(options.protocol).toEqual(["http", "https"]);
    });
  });

  describe("ConfigHelper", () => {
    describe("createHttpConfig", () => {
      it("should create HTTP config with default values", () => {
        const config = ConfigHelper.createHttpConfig(app);
        
        expect(config.hostname).toBe("localhost");
        expect(config.port).toBe(3000);
        expect(config.protocol).toBe("http");
        expect(config.trace).toBe(false);
        expect(config.ext).toEqual({});
        expect(config.connectionPool?.maxConnections).toBe(1000);
        expect(config.connectionPool?.connectionTimeout).toBe(30000);
        expect(config.connectionPool?.keepAliveTimeout).toBe(5000);
      });

      it("should create HTTP config with custom values", () => {
        const customOptions = {
          hostname: "127.0.0.1",
          port: 8080,
          protocol: "http" as KoattyProtocol,
          trace: true,
          ext: { custom: "value" },
          connectionPool: {
            maxConnections: 500,
            connectionTimeout: 60000
          }
        };

        const config = ConfigHelper.createHttpConfig(app,customOptions);
        
        expect(config.hostname).toBe("127.0.0.1");
        expect(config.port).toBe(8080);
        expect(config.protocol).toBe("http");
        expect(config.trace).toBe(true);
        expect(config.ext).toEqual({ custom: "value" });
        expect(config.connectionPool?.maxConnections).toBe(500);
        expect(config.connectionPool?.connectionTimeout).toBe(60000);
      });

      it("should merge connection pool options correctly", () => {
        const config = ConfigHelper.createHttpConfig( app,{
          connectionPool: {
            maxConnections: 2000
            // Only specify maxConnections, others should use defaults
          }
        });
        
        expect(config.connectionPool?.maxConnections).toBe(2000);
        expect(config.connectionPool?.connectionTimeout).toBe(30000); // default
        expect(config.connectionPool?.keepAliveTimeout).toBe(5000); // default
      });
    });

    describe("createHttpsConfig", () => {
      it("should create HTTPS config with default values", () => {
        const config = ConfigHelper.createHttpsConfig(app);
        
        expect(config.hostname).toBe("localhost");
        expect(config.port).toBe(443); // HTTPS default port
        expect(config.protocol).toBe("https");
        expect(config.trace).toBe(false);
        expect(config.connectionPool?.maxConnections).toBe(1000);
      });

      it("should create HTTPS config with SSL configuration", () => {
        const sslConfig: SSL1Config = {
          mode: "manual",
          key: "test-key",
          cert: "test-cert",
          requestCert: true,
          rejectUnauthorized: false
        };

        const config = ConfigHelper.createHttpsConfig(app,{
          hostname: "secure.example.com",
          port: 443,
          ssl: sslConfig,
          ext: {
            key: "ssl-key-content",
            cert: "ssl-cert-content"
          }
        });
        
        expect(config.hostname).toBe("secure.example.com");
        expect(config.port).toBe(443);
        expect(config.ssl?.mode).toBe("manual");
        expect(config.ssl?.requestCert).toBe(true);
        expect(config.ext?.key).toBe("ssl-key-content");
      });

      it("should handle different SSL modes", () => {
        const modes: Array<"auto" | "manual" | "mutual_tls"> = ["auto", "manual", "mutual_tls"];
        
        modes.forEach(mode => {
          const config = ConfigHelper.createHttpsConfig(app,{
            ssl: { mode }
          });
          expect(config.ssl?.mode).toBe(mode);
        });
      });
    });

    describe("createHttp2Config", () => {
      it("should create HTTP/2 config with default values", () => {
        const config = ConfigHelper.createHttp2Config(app);
        
        expect(config.hostname).toBe("localhost");
        expect(config.port).toBe(443); // HTTP/2 default port (HTTPS)
        expect(config.protocol).toBe("http2");
        expect(config.ssl).toBeDefined();
      });

      it("should create HTTP/2 config with custom settings", () => {
        const config = ConfigHelper.createHttp2Config(app,{
          hostname: "h2.example.com",
          port: 8443,
          ssl: {
            mode: "auto",
            allowHTTP1: true
          },
          ext: {
            key: "h2-key",
            cert: "h2-cert"
          }
        });
        
        expect(config.hostname).toBe("h2.example.com");
        expect(config.port).toBe(8443);
        expect(config.ssl?.allowHTTP1).toBe(true);
        expect(config.ext?.key).toBe("h2-key");
      });

      it("should configure HTTP/2 with SSL settings", () => {
        const config = ConfigHelper.createHttp2Config(app);
        
        expect(config.ssl).toBeDefined();
        expect(config.connectionPool).toBeDefined();
        expect(config.ext).toBeDefined();
      });
    });

    describe("createGrpcConfig", () => {
      it("should create gRPC config with default values", () => {
        const config = ConfigHelper.createGrpcConfig(app);
        
        expect(config.hostname).toBe("localhost");
        expect(config.port).toBe(50051); // gRPC default port
        expect(config.protocol).toBe("grpc");
        expect(config.connectionPool?.maxConnections).toBe(1000);
      });

      it("should create gRPC config with SSL enabled", () => {
        const sslConfig: SSLConfig = {
          enabled: true,
          keyFile: "/path/to/key.pem",
          certFile: "/path/to/cert.pem",
          clientCertRequired: true
        };

        const config = ConfigHelper.createGrpcConfig(app,{
          hostname: "grpc.example.com",
          port: 50051,
          ssl: sslConfig,
          ext: {
            protoFile: "/path/to/service.proto"
          }
        });
        
        expect(config.hostname).toBe("grpc.example.com");
        expect(config.port).toBe(50051);
        expect(config.ssl?.enabled).toBe(true);
        expect(config.ssl?.clientCertRequired).toBe(true);
        expect(config.ext?.protoFile).toBe("/path/to/service.proto");
      });

      it("should create gRPC config with connection pool settings", () => {
        const config = ConfigHelper.createGrpcConfig(app,{
          connectionPool: {
            maxConnections: 2000,
            protocolSpecific: {
              keepAliveTime: 60000,
              maxReceiveMessageLength: 8 * 1024 * 1024
            }
          }
        });
        
        expect(config.connectionPool?.maxConnections).toBe(2000);
        expect(config.connectionPool?.protocolSpecific).toBeDefined();
      });
    });

    describe("createWebSocketConfig", () => {
      it("should create WebSocket config with default values", () => {
        const config = ConfigHelper.createWebSocketConfig(app);
        
        expect(config.hostname).toBe("localhost");
        expect(config.port).toBe(8080); // WebSocket default port
        expect(config.protocol).toBe("ws");
        expect(config.connectionPool?.maxConnections).toBe(1000);
      });

      it("should create WebSocket config with SSL for WSS", () => {
        const sslConfig: SSLConfig = {
          enabled: true,
          keyFile: "/path/to/ws-key.pem",
          certFile: "/path/to/ws-cert.pem"
        };

        const config = ConfigHelper.createWebSocketConfig(app,{
          hostname: "ws.example.com",
          port: 8080,
          protocol: "wss",
          ssl: sslConfig
        });
        
        expect(config.hostname).toBe("ws.example.com");
        expect(config.port).toBe(8080);
        expect(config.protocol).toBe("wss");
        expect(config.ssl?.enabled).toBe(true);
      });

      it("should configure WebSocket connection pool settings", () => {
        const config = ConfigHelper.createWebSocketConfig(app,{
          connectionPool: {
            maxConnections: 2000,
            pingInterval: 5000,
            pongTimeout: 3000
          }
        });
        
        expect(config.connectionPool?.maxConnections).toBe(2000);
        expect(config.connectionPool?.pingInterval).toBe(5000);
        expect(config.connectionPool?.pongTimeout).toBe(3000);
      });
    });
  });

  describe("SSL Configurations", () => {
    it("should create valid SSL config", () => {
      const sslConfig: SSLConfig = {
        enabled: true,
        keyFile: "/path/to/key.pem",
        certFile: "/path/to/cert.pem",
        caFile: "/path/to/ca.pem",
        clientCertRequired: false,
        key: "key-content",
        cert: "cert-content",
        passphrase: "secret"
      };

      expect(sslConfig.enabled).toBe(true);
      expect(sslConfig.keyFile).toBe("/path/to/key.pem");
      expect(sslConfig.clientCertRequired).toBe(false);
    });

    it("should create valid SSL1 config for HTTPS", () => {
      const ssl1Config: SSL1Config = {
        mode: "mutual_tls",
        requestCert: true,
        rejectUnauthorized: true,
        key: "key-content",
        cert: "cert-content",
        ciphers: "HIGH:!aNULL:!MD5",
        honorCipherOrder: true
      };

      expect(ssl1Config.mode).toBe("mutual_tls");
      expect(ssl1Config.requestCert).toBe(true);
      expect(ssl1Config.ciphers).toBe("HIGH:!aNULL:!MD5");
    });

    it("should create valid SSL2 config for HTTP/2", () => {
      const ssl2Config: SSL2Config = {
        mode: "auto",
        allowHTTP1: true,
        requestCert: false,
        rejectUnauthorized: true,
        secureProtocol: "TLSv1_3_method"
      };

      expect(ssl2Config.mode).toBe("auto");
      expect(ssl2Config.allowHTTP1).toBe(true);
      expect(ssl2Config.secureProtocol).toBe("TLSv1_3_method");
    });
  });

  describe("Server Options Validation", () => {
    it("should validate HttpServerOptions", () => {
      const options: HttpServerOptions = {
        hostname: "localhost",
        port: 3000,
        protocol: "http",
        connectionPool: {
          maxConnections: 1000,
          connectionTimeout: 30000
        }
      };

      expect(options.protocol).toBe("http");
      expect(options.connectionPool?.maxConnections).toBe(1000);
    });

    it("should validate HttpsServerOptions", () => {
      const options: HttpsServerOptions = {
        hostname: "localhost",
        port: 443,
        protocol: "https",
        ssl: {
          mode: "manual",
          requestCert: true
        },
        ext: {
          key: "ssl-key",
          cert: "ssl-cert"
        }
      };

      expect(options.protocol).toBe("https");
      expect(options.ssl?.mode).toBe("manual");
      expect(options.ext?.key).toBe("ssl-key");
    });

    it("should validate Http2ServerOptions", () => {
      const options: Http2ServerOptions = {
        hostname: "localhost",
        port: 8443,
        protocol: "http2",
        ssl: {
          mode: "auto",
          allowHTTP1: true
        },
        http2: {
          maxHeaderListSize: 8192,
          settings: {
            enablePush: false,
            maxConcurrentStreams: 200
          }
        }
      };

      expect(options.protocol).toBe("http2");
      expect(options.ssl?.allowHTTP1).toBe(true);
      expect(options.http2?.settings?.enablePush).toBe(false);
    });

    it("should validate WebSocketServerOptions", () => {
      const options: WebSocketServerOptions = {
        hostname: "localhost",
        port: 8080,
        protocol: "ws",
        wsOptions: {
          maxPayload: 1024,
          perMessageDeflate: false
        },
        ssl: {
          enabled: false
        }
      };

      expect(options.protocol).toBe("ws");
      expect(options.wsOptions?.maxPayload).toBe(1024);
      expect(options.ssl?.enabled).toBe(false);
    });

    it("should validate GrpcServerOptions", () => {
      const options: GrpcServerOptions = {
        hostname: "localhost",
        port: 50051,
        protocol: "grpc",
        channelOptions: {
          'grpc.keepalive_time_ms': 60000
        },
        ssl: {
          enabled: true,
          clientCertRequired: true
        },
        ext: {
          protoFile: "service.proto"
        }
      };

      expect(options.protocol).toBe("grpc");
      expect(options.channelOptions?.['grpc.keepalive_time_ms']).toBe(60000);
      expect(options.ssl?.enabled).toBe(true);
      expect(options.ext?.protoFile).toBe("service.proto");
    });
  });
}); 