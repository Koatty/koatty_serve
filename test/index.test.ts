import { NewServe } from "../src/index";
import { KoattyApplication } from "koatty_core";
import { HttpServer } from "../src/server/http";
import { HttpsServer } from "../src/server/https";
import { Http2Server } from "../src/server/http2";
import { WsServer } from "../src/server/ws";
import { GrpcServer } from "../src/server/grpc";

// Mock KoattyApplication
class MockKoattyApplication {
  config(key?: string, defaultValue?: any) {
    return defaultValue;
  }
}

describe("NewServe", () => {
  let app: KoattyApplication;

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
  });

  it("should create HTTP server instance", () => {
    const server = NewServe(app);
    expect(server).toBeInstanceOf(HttpServer);
  });

  it("should create HTTPS server instance", () => {
    const server = NewServe(app, { 
      protocol: "https",
      hostname: "127.0.0.1",
      port: 3000,
      ext: {
        keyFile: "test/temp/test-key.pem",
        crtFile: "test/temp/test-cert.pem"
      }
    });
    expect(server).toBeInstanceOf(HttpsServer);
  });

  it("should create HTTP2 server instance", () => {
    const server = NewServe(app, { 
      protocol: "http2",
      hostname: "127.0.0.1",
      port: 3000,
      ext: {
        keyFile: "test/temp/test-key.pem",
        crtFile: "test/temp/test-cert.pem"
      }
    });
    expect(server).toBeInstanceOf(Http2Server);
  });

  it("should create WebSocket server instance", () => {
    const server = NewServe(app, { 
      protocol: "ws",
      hostname: "127.0.0.1",
      port: 3000
    });
    expect(server).toBeInstanceOf(WsServer);
  });

  it("should create gRPC server instance", () => {
    const server = NewServe(app, { 
      protocol: "grpc",
      hostname: "127.0.0.1",
      port: 3000
    });
    expect(server).toBeInstanceOf(GrpcServer);
  });
});
