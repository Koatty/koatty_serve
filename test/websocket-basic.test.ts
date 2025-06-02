import { KoattyApplication } from "koatty_core";
import { WsServer } from "../src/server/ws";

// Mock KoattyApplication
class MockKoattyApplication {
  config(key?: string, defaultValue?: any) {
    return defaultValue;
  }
  
  callback(protocol?: string) {
    return (req: any, client: any) => {
      // Mock WebSocket message handler
    };
  }
}

describe("WebSocket Basic Functionality", () => {
  let app: KoattyApplication;
  let wsServer: WsServer;

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
  });

  afterEach(() => {
    if (wsServer) {
      wsServer.Stop();
    }
  });

  it("should create WebSocket server with connection management", () => {
    wsServer = new WsServer(app, {
      hostname: '127.0.0.1',
      port: 3020,
      protocol: 'ws',
      maxConnections: 100,
      connectionTimeout: 5000
    });

    expect(wsServer).toBeDefined();
    expect(wsServer.getConnectionStats().max).toBe(100);
    expect(wsServer.getConnectionStats().current).toBe(0);
  });

  it("should have proper connection management methods", () => {
    wsServer = new WsServer(app, {
      hostname: '127.0.0.1',
      port: 3021,
      protocol: 'ws',
      maxConnections: 50
    });

    // Test connection stats method
    const stats = wsServer.getConnectionStats();
    expect(stats).toHaveProperty('current');
    expect(stats).toHaveProperty('max');
    expect(stats.max).toBe(50);
    expect(stats.current).toBe(0);
  });

  it("should handle WSS protocol configuration", () => {
    // Test WSS configuration without actually creating SSL server
    const options = {
      hostname: '127.0.0.1',
      port: 3022,
      protocol: 'wss' as const,
      maxConnections: 200,
      ext: {
        server: null // Use external server to avoid SSL cert issues
      }
    };

    wsServer = new WsServer(app, options);

    expect(wsServer).toBeDefined();
    expect(wsServer.getConnectionStats().max).toBe(200);
    expect(wsServer.options.protocol).toBe('wss');
  });
}); 