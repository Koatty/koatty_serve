
import { HttpServer } from "../../src/server/http";
import { KoattyApplication } from "koatty_core";
import http from "http";
import { AddressInfo } from "net";
import net from "net";
import { DefaultLogger as Logger } from "koatty_logger";

// Mock KoattyApplication
class MockKoattyApplication {
  callback() {
    return (req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200);
      res.end("OK");
    };
  }
}

describe("HttpServer", () => {
  let app: KoattyApplication;
  let server: HttpServer;
  const defaultOptions = {
    port: 0, // 使用 0 让系统分配随机端口
    hostname: "127.0.0.1",
    protocol: "http" as const,
  };

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
    server = new HttpServer(app, defaultOptions);
    jest.spyOn(Logger, "Info").mockImplementation(() => {});
    jest.spyOn(Logger, "Error").mockImplementation(() => {});
  });

  afterEach(async () => {
    try {
      if (server.server.listening) {
        // Force close all connections
        server.server.closeAllConnections?.();
        
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
      expect(server).toBeInstanceOf(HttpServer);
      expect(server.server).toBeInstanceOf(http.Server);
    });

    it("should initialize with correct options", () => {
        const options = {
        port: 0,
        hostname: "localhost",
        protocol: "http" as const,
      };
      const serverWithOptions = new HttpServer(app, options);
      expect(serverWithOptions.options).toEqual(options);
    });
  });

  describe("Server Lifecycle", () => {
    it("should start server and listen on specified port", (done) => {
      server.Start(() => {
        const address = server.server.address() as AddressInfo;
        expect(address.port).toBeGreaterThan(0);
        expect(address.address).toBe("127.0.0.1");
        done();
      });
    });

    it("should stop server", (done) => {
      server.Start(() => {
        server.Stop(() => {
          expect(server.server.address()).toBeNull();
          done();
        });
      });
    });

    it("should handle start without callback", (done) => {
      const srv = server.Start();
      srv.on("listening", () => {
        const address = srv.address() as AddressInfo;
        expect(address.port).toBeGreaterThan(0);
        done();
      });
    });
  });

  describe("Configuration Changes", () => {
    it("should detect config changes", () => {
      const updated = server.updateConfig({ port: 50080 });
      expect(updated).toBeTruthy();
    });

    it("should handle port change", (done) => {
      server.Start(() => {
        const originalPort = (server.server.address() as AddressInfo).port;
        
        // 模拟配置变更
        (server as any).applyConfigChanges(["port"], { port: 0 }); // 使用 0 获取新的随机端口

        // 给服务器一些时间重启
        setTimeout(() => {
          const newPort = (server.server.address() as AddressInfo).port;
          expect(newPort).not.toBe(originalPort);
          done();
        }, 100);
      });
    });

    it("should handle hostname change", (done) => {
      server.Start(() => {
        const originalAddress = server.server.address() as AddressInfo;
        
        // 模拟配置变更
        (server as any).applyConfigChanges(["hostname"], { hostname: "localhost" });

        // 给服务器一些时间重启
        setTimeout(() => {
          const newAddress = server.server.address() as AddressInfo;
          expect(newAddress.address).not.toBe(originalAddress.address);
          done();
        }, 100);
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle client errors", (done) => {
      server.Start(() => {
        const address = server.server.address() as AddressInfo;
        
        const socket = net.createConnection({
          port: address.port,
          host: address.address
        }, () => {
          // 发送无效的 HTTP 请求
          socket.write("Invalid HTTP Request\r\n");
        });

        socket.on("data", (data) => {
          expect(data.toString()).toContain("400 Bad Request");
          socket.destroy();
          done();
        });
      });
    });

    it("should handle basic HTTP request", (done) => {
      server.Start(() => {
        const address = server.server.address() as AddressInfo;
        
        http.get(`http://${address.address}:${address.port}`, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            expect(res.statusCode).toBe(200);
            expect(data).toBe("OK");
            done();
          });
        });
      });
    });
  });
});
