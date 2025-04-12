import { GrpcServer } from "../../src/server/grpc";
import { KoattyApplication } from "koatty_core";
import { Server, ServerCredentials, ServiceDefinition, UntypedHandleCall } from "@grpc/grpc-js";
import { DefaultLogger as Logger } from "koatty_logger";

// Mock KoattyApplication
class MockKoattyApplication {
  callback() {
    return {};
  }
}

// Mock GRPC Service
const mockServiceDefinition: ServiceDefinition = {
  testMethod: {
    path: "/test/TestMethod",
    requestStream: false,
    responseStream: false,
    requestSerialize: () => Buffer.from(""),
    requestDeserialize: () => ({}),
    responseSerialize: () => Buffer.from(""),
    responseDeserialize: () => ({}),
  }
};

const mockImplementation = {
  testMethod: (call: any, callback: any) => {
    callback(null, { message: "OK" });
  }
};

describe("GrpcServer", () => {
  let app: KoattyApplication;
  let server: GrpcServer;
  const defaultOptions = {
    port: 0,
    hostname: "127.0.0.1",
    protocol: "grpc" as const,
    ext: {}
  };

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
    server = new GrpcServer(app, defaultOptions);
    jest.spyOn(Logger, "Info").mockImplementation(() => {});
    jest.spyOn(Logger, "Error").mockImplementation(() => {});
  });

  afterEach((done) => {
    if (server.server) {
      server.Stop(done);
    } else {
      done();
    }
  });

  describe("Server Initialization", () => {
    it("should create server instance", () => {
      expect(server).toBeInstanceOf(GrpcServer);
      expect(server.server).toBeInstanceOf(Server);
    });

    it("should initialize with correct options", () => {
      const options = {
        port: 3000,
        hostname: "localhost",
        protocol: "grpc" as const,
        channelOptions: {
          "grpc.max_receive_message_length": 1024 * 1024 * 4
        },
        ext: {}
      };
      const serverWithOptions = new GrpcServer(app, options);
      expect(serverWithOptions.options).toEqual(options);
    });
  });

  describe("Server Lifecycle", () => {
    it("should start server successfully", (done) => {
      const srv = server.Start(() => {
        expect(srv).toBeInstanceOf(Server);
        done();
      });
    }, 10000);

    it("should stop server successfully", (done) => {
      const srv = server.Start();
      server.Stop(() => {
        expect(srv).toBeDefined();
        done();
      });
    }, 10000);

    it("should handle start without callback", () => {
      const srv = server.Start();
      expect(srv).toBeInstanceOf(Server);
    });
  });

  describe("Configuration Changes", () => {
    it("should detect config changes", () => {
      const updated = server.updateConfig({ port: 50083 });
      expect(updated).toBeTruthy();
    });
  });

  describe("Service Registration", () => {
    it("should register service successfully", () => {
      server.RegisterService({
        service: mockServiceDefinition,
        implementation: mockImplementation
      });
      expect(server.server).toBeDefined();
    });
  });

  
});
