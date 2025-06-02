/*
 * @Description: gRPC Server Tests
 * @Usage: 测试 gRPC 服务器的增强功能
 * @Author: koatty_serve
 * @Date: 2024-11-27
 */

import { GrpcServer, GrpcServerOptions } from "../src/server/grpc";

// Mock KoattyApplication
const mockApp = {
  callback: jest.fn(() => jest.fn())
};

jest.mock("koatty_core", () => ({
  KoattyApplication: jest.fn().mockImplementation(() => mockApp)
}));

// Mock @grpc/grpc-js
jest.mock("@grpc/grpc-js", () => ({
  Server: jest.fn().mockImplementation(() => ({
    bindAsync: jest.fn(),
    addService: jest.fn(),
    tryShutdown: jest.fn(),
    forceShutdown: jest.fn()
  })),
  ServerCredentials: {
    createInsecure: jest.fn().mockReturnValue("insecure-credentials"),
    createSsl: jest.fn().mockReturnValue("ssl-credentials")
  }
}));

// Mock file system
jest.mock("fs", () => ({
  readFileSync: jest.fn().mockReturnValue(Buffer.from("mock-certificate-data"))
}));

// Mock structured logger
jest.mock("../src/utils/structured-logger", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    logServerEvent: jest.fn(),
    logConnectionEvent: jest.fn(),
    createChild: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      logConnectionEvent: jest.fn()
    })
  }),
  generateTraceId: jest.fn().mockReturnValue("trace_12345")
}));

// Mock terminus
jest.mock("../src/utils/terminus", () => ({
  CreateTerminus: jest.fn()
}));

describe("GrpcServer Enhanced Features", () => {
  let app: any;

  beforeEach(() => {
    const { KoattyApplication } = require("koatty_core");
    app = new KoattyApplication();
    jest.clearAllMocks();
  });

  describe("SSL/TLS Configuration", () => {
    test("should create insecure credentials when SSL is disabled", () => {
      const { ServerCredentials } = require("@grpc/grpc-js");
      
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc",
        ssl: {
          enabled: false
        }
      };

      const server = new GrpcServer(app, options);
      server.Start();

      expect(ServerCredentials.createInsecure).toHaveBeenCalled();
      expect(ServerCredentials.createSsl).not.toHaveBeenCalled();
    });

    test("should create SSL credentials when SSL is enabled", () => {
      const { ServerCredentials } = require("@grpc/grpc-js");
      const fs = require("fs");
      
      const options: GrpcServerOptions = {
        hostname: "0.0.0.0",
        port: 443,
        protocol: "grpc",
        ssl: {
          enabled: true,
          keyFile: "/path/to/key.pem",
          certFile: "/path/to/cert.pem"
        }
      };

      const server = new GrpcServer(app, options);
      server.Start();

      expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/key.pem");
      expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/cert.pem");
      expect(ServerCredentials.createSsl).toHaveBeenCalled();
    });

    test("should support mutual TLS with client certificate verification", () => {
      const { ServerCredentials } = require("@grpc/grpc-js");
      const fs = require("fs");
      
      const options: GrpcServerOptions = {
        hostname: "0.0.0.0",
        port: 443,
        protocol: "grpc",
        ssl: {
          enabled: true,
          keyFile: "/path/to/key.pem",
          certFile: "/path/to/cert.pem",
          caFile: "/path/to/ca.pem",
          clientCertRequired: true
        }
      };

      const server = new GrpcServer(app, options);
      server.Start();

      expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/ca.pem");
      expect(ServerCredentials.createSsl).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Array),
        true
      );
    });

    test("should fallback to insecure when SSL configuration fails", () => {
      const { ServerCredentials } = require("@grpc/grpc-js");
      const fs = require("fs");
      
      // Mock file read failure
      fs.readFileSync.mockImplementation(() => {
        throw new Error("Certificate file not found");
      });

      const options: GrpcServerOptions = {
        hostname: "0.0.0.0",
        port: 443,
        protocol: "grpc",
        ssl: {
          enabled: true,
          keyFile: "/nonexistent/key.pem",
          certFile: "/nonexistent/cert.pem"
        }
      };

      const server = new GrpcServer(app, options);
      server.Start();

      expect(ServerCredentials.createInsecure).toHaveBeenCalled();
    });
  });

  describe("Connection Pool Configuration", () => {
    test("should configure default connection pool options", () => {
      const { Server } = require("@grpc/grpc-js");
      
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      new GrpcServer(app, options);

      expect(Server).toHaveBeenCalledWith(
        expect.objectContaining({
          'grpc.keepalive_time_ms': 30000,
          'grpc.keepalive_timeout_ms': 5000,
          'grpc.keepalive_permit_without_calls': 1,
          'grpc.max_receive_message_length': 4 * 1024 * 1024,
          'grpc.max_send_message_length': 4 * 1024 * 1024,
          'grpc.max_connection_idle_ms': 300000,
          'grpc.max_connection_age_ms': 3600000,
          'grpc.max_connection_age_grace_ms': 30000
        })
      );
    });

    test("should configure custom connection pool options", () => {
      const { Server } = require("@grpc/grpc-js");
      
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc",
        connectionPool: {
          keepAliveTime: 60000,
          keepAliveTimeout: 10000,
          maxReceiveMessageLength: 16 * 1024 * 1024,
          maxSendMessageLength: 16 * 1024 * 1024
        }
      };

      new GrpcServer(app, options);

      expect(Server).toHaveBeenCalledWith(
        expect.objectContaining({
          'grpc.keepalive_time_ms': 60000,
          'grpc.keepalive_timeout_ms': 10000,
          'grpc.max_receive_message_length': 16 * 1024 * 1024,
          'grpc.max_send_message_length': 16 * 1024 * 1024
        })
      );
    });
  });

  describe("Connection Statistics", () => {
    test("should provide connection statistics", () => {
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      const stats = server.getConnectionStats();

      expect(stats).toHaveProperty("activeConnections");
      expect(stats).toHaveProperty("totalConnections");
      expect(stats).toHaveProperty("connectionsPerSecond");
      expect(stats).toHaveProperty("averageLatency");
      expect(stats).toHaveProperty("errorRate");
      
      expect(typeof stats.activeConnections).toBe("number");
      expect(typeof stats.totalConnections).toBe("number");
      expect(typeof stats.connectionsPerSecond).toBe("number");
      expect(typeof stats.errorRate).toBe("number");
    });

    test("should initialize with zero connections", () => {
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      const stats = server.getConnectionStats();

      expect(stats.activeConnections).toBe(0);
      expect(stats.totalConnections).toBe(0);
      expect(stats.errorRate).toBe(0);
    });
  });

  describe("Service Registration with Monitoring", () => {
    test("should register service with method wrapping", () => {
      const { Server } = require("@grpc/grpc-js");
      const mockServer = {
        addService: jest.fn(),
        bindAsync: jest.fn(),
        tryShutdown: jest.fn()
      };
      Server.mockReturnValue(mockServer);

      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      
      // Create a mock service with proper type structure
      const mockService = {
        service: {
          serviceName: "TestService",
          TestMethod: {
            path: "/test.TestService/TestMethod",
            requestStream: false,
            responseStream: false,
            requestSerialize: jest.fn(),
            requestDeserialize: jest.fn(),
            responseSerialize: jest.fn(),
            responseDeserialize: jest.fn()
          }
        },
        implementation: {
          TestMethod: jest.fn()
        }
      };

      server.RegisterService(mockService as any);

      expect(mockServer.addService).toHaveBeenCalledWith(
        mockService.service,
        expect.objectContaining({
          TestMethod: expect.any(Function)
        })
      );
    });
  });

  describe("Server Lifecycle", () => {
    test("should start server with monitoring", () => {
      const { Server } = require("@grpc/grpc-js");
      const mockServer = {
        bindAsync: jest.fn((address, credentials, callback) => {
          // Simulate successful binding
          callback(null, 50051);
        }),
        addService: jest.fn(),
        tryShutdown: jest.fn()
      };
      Server.mockReturnValue(mockServer);

      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      const callback = jest.fn();
      
      server.Start(callback);

      expect(mockServer.bindAsync).toHaveBeenCalledWith(
        "127.0.0.1:50051",
        expect.any(String),
        expect.any(Function)
      );
      expect(callback).toHaveBeenCalled();
    });

    test("should stop server gracefully", (done) => {
      const { Server } = require("@grpc/grpc-js");
      const mockServer = {
        bindAsync: jest.fn(),
        addService: jest.fn(),
        tryShutdown: jest.fn((callback) => {
          callback(); // Simulate successful shutdown
        }),
        forceShutdown: jest.fn()
      };
      Server.mockReturnValue(mockServer);

      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      
      // Mock the gracefulShutdown method to resolve successfully
      jest.spyOn(server as any, 'gracefulShutdown').mockResolvedValue(undefined);
      
      server.Stop((err) => {
        expect(err).toBeUndefined();
        // Since we're now using gracefulShutdown, the test should verify that
        expect((server as any).gracefulShutdown).toHaveBeenCalled();
        done();
      });
    });

    test("should force shutdown when graceful shutdown fails", (done) => {
      const { Server } = require("@grpc/grpc-js");
      const mockServer = {
        bindAsync: jest.fn(),
        addService: jest.fn(),
        tryShutdown: jest.fn((callback) => {
          callback(new Error("Shutdown failed")); // Simulate shutdown error
        }),
        forceShutdown: jest.fn()
      };
      Server.mockReturnValue(mockServer);

      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      
      // Mock gracefulShutdown to reject with an error
      jest.spyOn(server as any, 'gracefulShutdown').mockRejectedValue(new Error("Graceful stop failed"));
      
      server.Stop((err) => {
        expect(err).toBeInstanceOf(Error);
        expect((server as any).gracefulShutdown).toHaveBeenCalled();
        expect(mockServer.forceShutdown).toHaveBeenCalled();
        done();
      });
    });
  });

  describe("Configuration Hot Reload", () => {
    test("should handle port changes by restarting server", async () => {
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      
      // Mock gracefulShutdown instead of Stop
      const gracefulShutdownSpy = jest.spyOn(server as any, 'gracefulShutdown').mockResolvedValue(undefined);
      const startSpy = jest.spyOn(server, 'Start').mockReturnValue(server.server);

      const newConfig = { port: 50052 };
      const updated = server.updateConfig(newConfig);

      expect(updated).toBe(true);
      
      // Wait a bit for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // The graceful restart should be called
      expect(gracefulShutdownSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();
    });

    test("should not restart for non-critical config changes", () => {
      const options: GrpcServerOptions = {
        hostname: "127.0.0.1",
        port: 50051,
        protocol: "grpc"
      };

      const server = new GrpcServer(app, options);
      
      // Mock gracefulShutdown to ensure it's not called
      const gracefulShutdownSpy = jest.spyOn(server as any, 'gracefulShutdown').mockResolvedValue(undefined);

      // Update a non-critical setting
      const newConfig = { 
        ext: { 
          customOption: "new-value" 
        } 
      };
      const updated = server.updateConfig(newConfig);

      expect(updated).toBe(true);
      expect(gracefulShutdownSpy).not.toHaveBeenCalled();
    });
  });
}); 