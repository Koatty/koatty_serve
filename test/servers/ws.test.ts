import { WsServer } from "../../src/server/ws";
import { KoattyApplication } from "koatty_core";
import { WebSocketServer } from "ws";
import { DefaultLogger as Logger } from "koatty_logger";

// Mock KoattyApplication
class MockKoattyApplication {
  callback() {
    return (req: any, res: any) => {
      res.writeHead(200);
      res.end("OK");
    };
  }
}

describe("WsServer", () => {
  let app: KoattyApplication;
  let server: WsServer;
  const defaultOptions = {
    port: 0,
    hostname: "127.0.0.1",
    protocol: "ws" as const
  };

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
    server = new WsServer(app, defaultOptions);
    jest.spyOn(Logger, "Info").mockImplementation(() => {});
    jest.spyOn(Logger, "Error").mockImplementation(() => {});
  });

  afterEach(async () => {
    try {
      if (server.server.clients.size > 0) {
        await new Promise<void>((resolve) => {
          server.Stop(() => {
            server.server.close(() => resolve());
          });
        });
      }
    } finally {
      jest.clearAllMocks();
      jest.restoreAllMocks();
      process.setMaxListeners(15);
    }
  });

  describe("Server Initialization", () => {
    it("should create server instance", () => {
      expect(server).toBeInstanceOf(WsServer);
      expect(server.server).toBeDefined();
    });

  });

  describe("Server Lifecycle", () => {
    it("should start server successfully", (done) => {
      server.Start(() => {
        expect(server.server.clients.size).toBeGreaterThanOrEqual(0);
        done();
      });
    }, 10000);

    it("should stop server successfully", (done) => {
      server.Start(() => {
        server.Stop(() => {
          expect(server.server.clients.size).toBe(0);
          done();
        });
      });
    }, 10000);
  });

  describe("Configuration Changes", () => {
    it("should detect config changes", () => {
      const updated = server.updateConfig({ port: 50084 });
      expect(updated).toBeTruthy();
    });
  });

  describe("WebSocket Behavior", () => {
    it("should handle WebSocket connections", (done) => {
      server.Start(() => {
        const mockRequest = {
          url: '/test',
          headers: {
            'upgrade': 'websocket',
            'connection': 'upgrade',
            'sec-websocket-key': 'test-key',
            'sec-websocket-version': '13'
          }
        };
        const mockSocket = {
          write: jest.fn(),
          end: jest.fn(),
          on: jest.fn(),
          once: jest.fn(),
          destroy: jest.fn()
        };
        // Simulate upgrade request
        server.httpServer.emit('upgrade', mockRequest, mockSocket, Buffer.from(''));
        setTimeout(() => {
          expect(mockSocket.write).not.toHaveBeenCalled(); // No error response
          done();
        }, 100);
      });
    });

    it("should handle WSS protocol", (done) => {
      const fs = require("fs");
      const wssOptions = {
        port: 0,
        hostname: "127.0.0.1",
        protocol: "wss" as const,
        ext: {
          key: fs.readFileSync("test/temp/test-key.pem", "utf8"),
          cert: fs.readFileSync("test/temp/test-cert.pem", "utf8")
        }
      };
      const wssServer = new WsServer(app, wssOptions);
      wssServer.Start(() => {
        expect(wssServer.httpServer).toBeInstanceOf(require("https").Server);
        wssServer.Stop(done);
      });
    });

    it("should use custom HTTP server", (done) => {
      const customServer = require("http").createServer();
      const options = {
        port: 3000,
        hostname: "127.0.0.1",
        protocol: "ws" as const,
        ext: {
          server: customServer,
        }
      };
      const wsServer = new WsServer(app, options);
      // Manually set noServer option after server creation
      wsServer.options.wsOptions = { noServer: true };
      expect(wsServer.httpServer).toBe(customServer);
      done();
    });

    it("should handle client errors", (done) => {
      server.Start(() => {
        // Simulate client error
        server.httpServer.emit("clientError", new Error("test error"), {
          end: (data: string) => {
            expect(data).toContain("400 Bad Request");
            done();
          }
        });
      });
    }, 10000);

    
  });
});
