import WebSocket from 'ws';
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
      if (client && typeof client.send === 'function') {
        client.send('echo: received');
      }
    };
  }
}

describe("WebSocket Connection Management", () => {
  let app: KoattyApplication;
  let wsServer: WsServer;
  const testPort = 3010;

  beforeEach(() => {
    app = new MockKoattyApplication() as unknown as KoattyApplication;
  });

  afterEach(async () => {
    if (wsServer) {
      await new Promise<void>((resolve) => {
        wsServer.Stop(() => resolve());
      });
    }
  });

  it("should limit WebSocket connections", (done) => {
    const maxConnections = 2;
    
    wsServer = new WsServer(app, {
      hostname: '127.0.0.1',
      port: testPort,
      protocol: 'ws',
      maxConnections,
      connectionTimeout: 5000
    });

    // Start server
    wsServer.Start(() => {
      let connectionCount = 0;
      let rejectedConnections = 0;

      // Create connections up to limit
      for (let i = 0; i < maxConnections + 2; i++) {
        const client = new WebSocket(`ws://127.0.0.1:${testPort}`);
        
        client.on('open', () => {
          connectionCount++;
        });

        client.on('close', (code, reason) => {
          if (code === 1013) { // Server overloaded
            rejectedConnections++;
          }
        });

        client.on('error', (err) => {
          // Connection rejected by server
          rejectedConnections++;
        });
      }

      // Wait for connections to be processed
      setTimeout(() => {
        const stats = wsServer.getConnectionStats();
        
        // Should have accepted only maxConnections
        expect(stats.current).toBeLessThanOrEqual(maxConnections);
        expect(stats.max).toBe(maxConnections);
        
        // Should have rejected excess connections
        expect(rejectedConnections).toBeGreaterThan(0);
        
        done();
      }, 1000);
    });
  }, 10000);

  it("should clean up connection resources on close", (done) => {
    wsServer = new WsServer(app, {
      hostname: '127.0.0.1',
      port: testPort,
      protocol: 'ws',
      maxConnections: 100,
      connectionTimeout: 5000
    });

    wsServer.Start(() => {
      const client = new WebSocket(`ws://127.0.0.1:${testPort}`);
      
      client.on('open', () => {
        // Check connection was added
        expect(wsServer.getConnectionStats().current).toBe(1);
        
        // Close the connection
        client.close();
      });

      client.on('close', () => {
        // Check connection was removed after a short delay
        setTimeout(() => {
          expect(wsServer.getConnectionStats().current).toBe(0);
          done();
        }, 100);
      });
    });
  }, 10000);

  it("should handle server shutdown gracefully", (done) => {
    wsServer = new WsServer(app, {
      hostname: '127.0.0.1',
      port: testPort,
      protocol: 'ws',
      maxConnections: 100,
      connectionTimeout: 5000
    });

    wsServer.Start(() => {
      const clients: WebSocket[] = [];
      let closedConnections = 0;

      // Create multiple connections
      for (let i = 0; i < 3; i++) {
        const client = new WebSocket(`ws://127.0.0.1:${testPort}`);
        clients.push(client);
        
        client.on('close', (code, reason) => {
          closedConnections++;
          if (code === 1001) { // Server shutting down
            expect(reason.toString()).toBe('Server shutting down');
          }
        });
      }

      // Wait for connections to establish
      setTimeout(() => {
        expect(wsServer.getConnectionStats().current).toBe(3);
        
        // Stop server
        wsServer.Stop(() => {
          // All connections should be closed
          setTimeout(() => {
            expect(closedConnections).toBe(3);
            expect(wsServer.getConnectionStats().current).toBe(0);
            done();
          }, 100);
        });
      }, 500);
    });
  }, 10000);

  it("should track connection stats correctly", (done) => {
    const maxConnections = 5;
    
    wsServer = new WsServer(app, {
      hostname: '127.0.0.1',
      port: testPort,
      protocol: 'ws',
      maxConnections,
      connectionTimeout: 5000
    });

    wsServer.Start(() => {
      const stats1 = wsServer.getConnectionStats();
      expect(stats1.current).toBe(0);
      expect(stats1.max).toBe(maxConnections);

      // Create connections
      const clients: WebSocket[] = [];
      for (let i = 0; i < 3; i++) {
        const client = new WebSocket(`ws://127.0.0.1:${testPort}`);
        clients.push(client);
      }

      setTimeout(() => {
        const stats2 = wsServer.getConnectionStats();
        expect(stats2.current).toBe(3);
        expect(stats2.max).toBe(maxConnections);

        // Close one connection
        clients[0].close();

        setTimeout(() => {
          const stats3 = wsServer.getConnectionStats();
          expect(stats3.current).toBe(2);
          done();
        }, 200);
      }, 500);
    });
  }, 10000);
}); 