import { HttpsServer } from "../../src/server/https";
import { KoattyApplication } from "koatty_core";
import { Server } from "https";
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

describe("HttpsServer", () => {
  let app: KoattyApplication;
  let server: HttpsServer;
  const defaultOptions = {
    port: 0,
    hostname: "127.0.0.1",
    protocol: "https" as const,
    ext: {
      key: fs.readFileSync(keyFile, "utf8"),
      cert: fs.readFileSync(certFile, "utf8")
    }
  };

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
    server = new HttpsServer(app, defaultOptions);
    jest.spyOn(Logger, "Info").mockImplementation(() => {});
    jest.spyOn(Logger, "Error").mockImplementation(() => {});
  });

  afterEach(async () => {
    try {
      if (server.server.listening) {
        // Force close all connections
        server.server.closeAllConnections();
        
        // Remove all listeners to prevent memory leaks
        server.server.removeAllListeners();
        
        await new Promise<void>((resolve) => {
          // First call Stop to clean up resources
          server.Stop(() => {
            // Then close the server if still running
            if (server.server.listening) {
              server.server.close(() => {
                server.server.unref();
                // Additional cleanup
                server.server.removeAllListeners();
                resolve();
              });
            } else {
              resolve();
            }
          });
        });
      }
    } catch (err) {
      console.error('Cleanup error:', err);
      // Rethrow to fail the test
      throw err;
    } finally {
      jest.clearAllMocks();
      jest.restoreAllMocks();
      // Add small delay to ensure cleanup completes
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  describe("Server Initialization", () => {
    it("should create server instance", () => {
      expect(server).toBeInstanceOf(HttpsServer);
      expect(server.server).toBeDefined();
    });

    it("should initialize with correct options", () => {
      const options = {
        port: 0,
        hostname: "localhost",
        protocol: "https" as const,
        ext: {
          key: fs.readFileSync(keyFile, "utf8"),
          cert: fs.readFileSync(certFile, "utf8")
        }
      };
      const serverWithOptions = new HttpsServer(app, options);
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
      const updated = server.updateConfig({ port: 50081 });
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
