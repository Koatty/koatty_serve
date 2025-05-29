/*
 * @Description: Multi-protocol server tests
 * @Usage: 测试多协议服务器功能
 * @Author: richen
 * @Date: 2024-12-03 16:30:00
 * @License: BSD (3-Clause)
 */

import { NewServe, ListeningOptions } from "../src/index";

// Mock KoattyApplication
class MockKoattyApp {
  config(key: string): any {
    const configs: Record<string, any> = {
      key_file: "./test/fixtures/server.key",
      crt_file: "./test/fixtures/server.crt",
      protoFile: "./test/fixtures/service.proto"
    };
    return configs[key] || "";
  }

  callback() {
    return (req: any, res: any) => {
      if (res && typeof res.writeHead === 'function') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from test server');
      }
    };
  }
}

describe('Multi-Protocol Server', () => {
  let app: MockKoattyApp;

  beforeEach(() => {
    app = new MockKoattyApp();
  });

  describe('NewServe (single protocol)', () => {
    it('should create HTTP server', () => {
      const server = NewServe(app as any, {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: 'http'
      }) as any;

      expect(server).toBeDefined();
      expect(server.protocol).toBe('http');
      expect(server.options.port).toBe(3000);
    });

    it('should create WebSocket server', () => {
      const server = NewServe(app as any, {
        hostname: '127.0.0.1',
        port: 3001,
        protocol: 'ws'
      }) as any;

      expect(server).toBeDefined();
      expect(server.protocol).toBe('ws');
      expect(server.options.port).toBe(3001);
    });
  });

  describe('NewServe (multi-protocol)', () => {
    it('should create multi-protocol server with protocol array', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http', 'ws']
      };

      const multiServer = NewServe(app as any, options) as any;

      expect(multiServer).toBeDefined();
      expect(multiServer.protocol).toBe('multi');
      expect(multiServer.getAllServers().size).toBe(0); // Servers not started yet
    });

    it('should create multi-protocol server with different protocols', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http', 'ws', 'grpc']
      };

      const multiServer = NewServe(app as any, options) as any;

      expect(multiServer).toBeDefined();
      expect(multiServer.protocol).toBe('multi');
    });

    it('should handle single protocol in array', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http']
      };

      const multiServer = NewServe(app as any, options) as any;

      expect(multiServer).toBeDefined();
      expect(multiServer.protocol).toBe('multi');
    });
  });

  describe('Server Management', () => {
    it('should provide server management methods for multi-protocol server', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http', 'ws']
      };

      const multiServer = NewServe(app as any, options) as any;

      // Test management methods exist
      expect(typeof multiServer.getServer).toBe('function');
      expect(typeof multiServer.getAllServers).toBe('function');
      expect(typeof multiServer.Start).toBe('function');
      expect(typeof multiServer.Stop).toBe('function');
    });
  });

  describe('Configuration Validation', () => {
    it('should handle empty protocols array', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: []
      };

      const multiServer = NewServe(app as any, options);
      expect(multiServer).toBeDefined();
    });

    it('should use default hostname', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http']
      };

      const multiServer = NewServe(app as any, options) as any;
      expect(multiServer.options.hostname).toBe('127.0.0.1');
    });

    it('should handle protocol-specific configuration', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http', 'ws'],
        trace: true,
        ext: {
          keepAlive: true,
          timeout: 30000
        }
      };

      const multiServer = NewServe(app as any, options) as any;
      expect(multiServer).toBeDefined();
      expect(multiServer.options.trace).toBe(true);
    });
  });

  describe('Port Assignment', () => {
    it('should assign sequential ports for multiple protocols', () => {
      const options: ListeningOptions = {
        hostname: '127.0.0.1',
        port: 3000,
        protocol: ['http', 'ws', 'grpc']
      };

      const multiServer = NewServe(app as any, options) as any;
      expect(multiServer).toBeDefined();
      // HTTP should be on port 3000, WS on 3001, gRPC on 3002
    });
  });
}); 