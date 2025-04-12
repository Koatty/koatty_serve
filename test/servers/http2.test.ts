import { Http2Server } from "../../src/server/http2";
import { KoattyApplication } from "koatty_core";
import type { Http2SecureServer } from "http2";
import { DefaultLogger as Logger } from "koatty_logger";
import fs from "fs";

// Mock KoattyApplication
class MockKoattyApplication {
  callback() {
    return (req: any, res: any) => {
      res.writeHead(200);
      res.end("OK");
    };
  }
}

// Use project temp cert files
const keyFile = "test/temp/test-key.pem";
const certFile = "test/temp/test-cert.pem";

describe("Http2Server", () => {
  let app: KoattyApplication;
  let server: Http2Server;
  const defaultOptions = {
    port: 0,
    hostname: "127.0.0.1",
    protocol: "http2" as const,
    ext: {
      key: fs.readFileSync(keyFile, "utf8"),
      cert: fs.readFileSync(certFile, "utf8")
    }
  };

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
    server = new Http2Server(app, defaultOptions);
    jest.spyOn(Logger, "Info").mockImplementation(() => {});
    jest.spyOn(Logger, "Error").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (server.server.listening) {
      await new Promise<void>((resolve) => server.Stop(() => resolve()));
    }
    jest.clearAllMocks();
  });

  describe("Server Initialization", () => {
    it("should create server instance", () => {
      expect(server).toBeInstanceOf(Http2Server);
      expect(server.server).toBeDefined();
    });

    it("should initialize with correct options", () => {
      const options = {
        port: 3000,
        hostname: "localhost",
        protocol: "http2" as const,
        ext: {
          key: fs.readFileSync(keyFile, "utf8"),
          cert: fs.readFileSync(certFile, "utf8")
        }
      };
      const serverWithOptions = new Http2Server(app, options);
      expect(serverWithOptions.options).toEqual(options);
    });
  });

  describe("Server Lifecycle", () => {
    it("should start server successfully", (done) => {
      server.Start(() => {
        expect(server.server.listening).toBeTruthy();
        done();
      });
    }, 10000);

    it("should stop server successfully", (done) => {
      server.Start(() => {
        server.Stop(() => {
          expect(server.server.listening).toBeFalsy();
          done();
        });
      });
    }, 10000);
  });

  describe("Configuration Changes", () => {
    it("should detect config changes", () => {
      const updated = server.updateConfig({ port: 50082 });
      expect(updated).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("should handle client errors", (done) => {
      server.Start(() => {
        // Simulate client error
        server.server.emit("clientError", new Error("Bad request"), {
          end: (data: string) => {
            expect(data).toContain("400 Bad Request");
            done();
          }
        });
      });
    });
  });
});
