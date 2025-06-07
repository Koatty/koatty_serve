import { NewServe, MultiProtocolServer } from "../src/index";
import { KoattyApplication } from "koatty_core";

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

  it("should create multi-protocol server with default HTTP protocol", () => {
    const server = NewServe(app);
    expect(server).toBeInstanceOf(MultiProtocolServer);
    // expect(Array.isArray(server.options.protocol)).toBe(true);
    expect(server.options.protocol).toBe("http");
  });

  it("should create multi-protocol server with HTTPS protocol", () => {
    const server = NewServe(app, { 
      protocol: "https",
      hostname: "127.0.0.1",
      port: 3000,
      ext: {
        keyFile: "test/temp/test-key.pem",
        crtFile: "test/temp/test-cert.pem"
      }
    });
    expect(server).toBeInstanceOf(MultiProtocolServer);
    // expect(Array.isArray(server.options.protocol)).toBe(true);
    expect(server.options.protocol).toBe("https");
  });

  it("should create multi-protocol server with HTTP2 protocol", () => {
    const server = NewServe(app, { 
      protocol: "http2",
      hostname: "127.0.0.1",
      port: 3000,
      ext: {
        keyFile: "test/temp/test-key.pem",
        crtFile: "test/temp/test-cert.pem"
      }
    });
    expect(server).toBeInstanceOf(MultiProtocolServer);
    // expect(Array.isArray(server.options.protocol)).toBe(true);
    expect(server.options.protocol).toBe("http2");
  });

  it("should create multi-protocol server with WebSocket protocol", () => {
    const server = NewServe(app, { 
      protocol: "ws",
      hostname: "127.0.0.1",
      port: 3000
    });
    expect(server).toBeInstanceOf(MultiProtocolServer);
    // expect(Array.isArray(server.options.protocol)).toBe(true);
    expect(server.options.protocol).toBe("ws");
  });

  it("should create multi-protocol server with gRPC protocol", () => {
    const server = NewServe(app, { 
      protocol: "grpc",
      hostname: "127.0.0.1",
      port: 3000
    });
    expect(server).toBeInstanceOf(MultiProtocolServer);
    // expect(Array.isArray(server.options.protocol)).toBe(true);
    expect(server.options.protocol).toBe("grpc");
  });
});
