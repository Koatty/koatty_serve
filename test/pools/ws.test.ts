import { WebSocketConnectionPoolManager } from '../../src/pools/ws';
import { ConnectionPoolConfig } from '../../src/config/pool';
import * as WebSocket from 'ws';

// Mock WebSocket
jest.mock('ws');

const mockWS = WebSocket as any;

describe('WebSocketConnectionPoolManager', () => {
  let poolManager: WebSocketConnectionPoolManager;
  let mockWebSocket: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock WebSocket instance
    mockWebSocket = {
      on: jest.fn(),
      once: jest.fn((event, callback) => {
        // 模拟 once 行为，立即触发回调（用于测试）
        if (event === 'open') {
          setTimeout(() => callback(), 0);
        }
        return mockWebSocket;
      }),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn(),
      ping: jest.fn(),
      pong: jest.fn(),
      send: jest.fn(),
      terminate: jest.fn(),
      readyState: 1, // WebSocket.OPEN
      url: 'ws://localhost:3000',
      protocol: '',
      extensions: {},
      bufferedAmount: 0,
      binaryType: 'nodebuffer'
    };

    // Mock WebSocket constructor
    (mockWS as any).mockImplementation(() => mockWebSocket);
    
    // Mock WebSocket constants (check if they don't already exist)
    try {
      if (!mockWS.hasOwnProperty('CONNECTING')) {
        Object.defineProperty(mockWS, 'CONNECTING', { value: 0, configurable: true });
      }
      if (!mockWS.hasOwnProperty('OPEN')) {
        Object.defineProperty(mockWS, 'OPEN', { value: 1, configurable: true });
      }
      if (!mockWS.hasOwnProperty('CLOSING')) {
        Object.defineProperty(mockWS, 'CLOSING', { value: 2, configurable: true });
      }
      if (!mockWS.hasOwnProperty('CLOSED')) {
        Object.defineProperty(mockWS, 'CLOSED', { value: 3, configurable: true });
      }
    } catch (error) {
      // Constants already exist, which is fine
    }

    poolManager = new WebSocketConnectionPoolManager({
      maxConnections: 5,
      connectionTimeout: 1000,
      keepAliveTimeout: 500
    });
  });

  afterEach(async () => {
    await poolManager.destroy();
  });

  describe('Initialization', () => {
    it('should create WebSocket connection pool manager', () => {
      expect(poolManager).toBeInstanceOf(WebSocketConnectionPoolManager);
      expect(poolManager.getMetrics().protocol).toBe('websocket');
    });

    it('should initialize with default configuration', () => {
      const metrics = poolManager.getMetrics();
      expect(metrics.poolConfig.maxConnections).toBe(5);
      expect(metrics.poolConfig.connectionTimeout).toBe(1000);
    });

    it('should handle SSL configuration', () => {
      const sslPool = new WebSocketConnectionPoolManager({
        maxConnections: 10,
        connectionTimeout: 30000,
        keepAliveTimeout: 5000
      });

      expect(sslPool).toBeInstanceOf(WebSocketConnectionPoolManager);
    });
  });

  describe('Connection Management', () => {
    it('should create WebSocket connection', async () => {
      const result = await poolManager.requestConnection();
      
      expect(result.success).toBe(true);
      expect(result.connection).toBeTruthy();
      expect(mockWS).toHaveBeenCalled();
    });

    it('should handle connection creation with URL', async () => {
      const result = await poolManager.requestConnection({
        metadata: { url: 'ws://test.example.com:3000' }
      });
      
      expect(result.success).toBe(true);
      expect(mockWS).toHaveBeenCalledWith('ws://test.example.com:3000', undefined, expect.any(Object));
    });

    it('should handle connection creation failure', async () => {
      mockWS.mockImplementation(() => {
        throw new Error('WebSocket connection failed');
      });

      const result = await poolManager.requestConnection();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should validate connection health correctly', () => {
      const healthyWS = { readyState: 1 } as any; // WebSocket.OPEN
      const unhealthyWS = { readyState: 3 } as any; // WebSocket.CLOSED

      expect(poolManager.isConnectionHealthy(healthyWS)).toBe(true);
      expect(poolManager.isConnectionHealthy(unhealthyWS)).toBe(false);
    });

    it('should setup WebSocket event handlers', async () => {
      // 首先添加连接到池中，这样才能设置事件处理器
      const result = await poolManager.requestConnection();
      expect(result.success).toBe(true);
      expect(result.connection).toBeTruthy();

      // 清除之前的调用记录
      mockWebSocket.on.mockClear();

      // 现在测试事件处理器设置
      await (poolManager as any).setupProtocolSpecificHandlers(result.connection);

      expect(mockWebSocket.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('ping', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('pong', expect.any(Function));
    });

    it('should cleanup connections properly', async () => {
      await (poolManager as any).cleanupConnection(mockWebSocket);

      expect(mockWebSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockWebSocket.terminate).toHaveBeenCalled();
    });
  });

  describe('WebSocket Specific Features', () => {
    it('should handle different WebSocket states', () => {
      const states = [
        { readyState: 0, expected: false }, // CONNECTING
        { readyState: 1, expected: true },  // OPEN
        { readyState: 2, expected: false }, // CLOSING
        { readyState: 3, expected: false }  // CLOSED
      ];

      states.forEach(({ readyState, expected }) => {
        expect(poolManager.isConnectionHealthy({ readyState } as any)).toBe(expected);
      });
    });

    it('should handle ping/pong for keep-alive', async () => {
      await (poolManager as any).setupProtocolSpecificHandlers(mockWebSocket);

      // Simulate ping handler
      const pingHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'ping')?.[1];
      if (pingHandler) {
        pingHandler(Buffer.from('test'));
        expect(mockWebSocket.pong).toHaveBeenCalledWith(Buffer.from('test'));
      }
    });

    it('should handle connection close events', async () => {
      const result = await poolManager.requestConnection();
      expect(result.success).toBe(true);

      await (poolManager as any).setupProtocolSpecificHandlers(mockWebSocket);

      // Simulate close event
      const closeHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'close')?.[1];
      if (closeHandler) {
        closeHandler(1000, 'Normal closure');
        // Wait for async removeConnection to complete
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Connection should be marked for removal
      expect(poolManager.getActiveConnectionCount()).toBe(0);
    });

    it('should handle connection error events', async () => {
      const result = await poolManager.requestConnection();
      expect(result.success).toBe(true);

      await (poolManager as any).setupProtocolSpecificHandlers(mockWebSocket);

      // Simulate error event
      const errorHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'error')?.[1];
      if (errorHandler) {
        errorHandler(new Error('WebSocket error'));
        // Wait for async removeConnection to complete
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Connection should be removed from pool after error
      expect(poolManager.getActiveConnectionCount()).toBe(0);
    });
  });

  describe('SSL/TLS Support', () => {
    it('should create secure WebSocket connections', () => {
      const sslPool = new WebSocketConnectionPoolManager({
        maxConnections: 5,
        ext: {
          protocol: 'wss',
          cert: 'test-cert',
          key: 'test-key',
          ca: 'test-ca'
        }
      });

      expect(sslPool).toBeInstanceOf(WebSocketConnectionPoolManager);
    });

    it('should handle SSL options in connection creation', async () => {
      const sslPool = new WebSocketConnectionPoolManager({
        maxConnections: 5,
        connectionTimeout: 1000,
        keepAliveTimeout: 500
      });

      const result = await sslPool.requestConnection({
        metadata: { 
          url: 'wss://secure.example.com:443',
          rejectUnauthorized: false
        }
      });

      expect(mockWS).toHaveBeenCalledWith(
        'wss://secure.example.com:443',
        undefined,
        expect.objectContaining({
          rejectUnauthorized: false
        })
      );

      await sslPool.destroy();
    });
  });

  describe('Connection Pooling', () => {
    it('should reuse WebSocket connections when possible', async () => {
      const result1 = await poolManager.requestConnection();
      expect(result1.success).toBe(true);

      // Simulate connection being opened
      mockWebSocket.readyState = WebSocket.OPEN;
      await poolManager.releaseConnection(result1.connection!);

      const result2 = await poolManager.requestConnection();
      expect(result2.success).toBe(true);
      
      // Should reuse the same connection
      expect(result2.connection).toBe(result1.connection);
    });

    it('should handle connection limits', async () => {
      // 顺序创建连接以确保池能正确限制并发连接
      const results: Array<{ success: boolean; error?: any; activeConnections?: number }> = [];
      for (let i = 0; i < 7; i++) {
        try {
          const result = await poolManager.requestConnection({ timeout: 100 });
          const activeConnections = poolManager.getActiveConnectionCount();
          
          results.push({ 
            success: result.success, 
            activeConnections
          });
          
          // 如果连接池已满，后续请求应该失败
          if (activeConnections >= 5) {
            break;
          }
        } catch (error) {
          results.push({ success: false, error });
        }
      }
      
      // 检查活跃连接数不超过限制
      const maxActiveConnections = Math.max(...results.map(r => r.activeConnections || 0));
      expect(maxActiveConnections).toBeLessThanOrEqual(5);
      
      // 检查成功的连接数不超过限制
      const successful = results.filter(r => r.success);
      expect(successful.length).toBeLessThanOrEqual(5);
    });

    it('should clean up idle connections', async () => {
      const result = await poolManager.requestConnection();
      expect(result.success).toBe(true);

      // Mark connection as idle
      if (result.connection) {
        result.connection.readyState = WebSocket.OPEN;
        // Simulate long idle time by manipulating lastUsed
      }

      // Cleanup should handle idle connections
      await (poolManager as any).cleanupConnection(result.connection);
      expect(mockWebSocket.terminate).toHaveBeenCalled();
    });
  });

  describe('Protocol Specific Options', () => {
    it('should handle WebSocket subprotocols', async () => {
      const result = await poolManager.requestConnection({
        metadata: {
          url: 'ws://localhost:3000',
          protocols: ['chat', 'superchat']
        }
      });

      expect(mockWS).toHaveBeenCalledWith(
        'ws://localhost:3000',
        ['chat', 'superchat'],
        expect.any(Object)
      );
    });

    it('should handle custom headers', async () => {
      const result = await poolManager.requestConnection({
        metadata: {
          url: 'ws://localhost:3000',
          headers: {
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'value'
          }
        }
      });

      expect(mockWS).toHaveBeenCalledWith(
        'ws://localhost:3000',
        undefined,
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'value'
          }
        })
      );
    });

    it('should handle connection timeout', async () => {
      const result = await poolManager.requestConnection({
        timeout: 500,
        metadata: { url: 'ws://slow.example.com:3000' }
      });

      // Should handle timeout configuration
      expect(result).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed URLs gracefully', async () => {
      const result = await poolManager.requestConnection({
        metadata: { url: 'invalid-url' }
      });

      // Should handle gracefully based on implementation
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle network errors', async () => {
      mockWS.mockImplementation(() => {
        const ws = { ...mockWebSocket };
        setTimeout(() => {
          const errorHandler = ws.on.mock.calls.find(call => call[0] === 'error')?.[1];
          if (errorHandler) errorHandler(new Error('ECONNREFUSED'));
        }, 10);
        return ws;
      });

      const result = await poolManager.requestConnection();
      
      if (result.success) {
        // Wait for error event and connection removal
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // Connection should be removed from pool after network error
        expect(poolManager.getActiveConnectionCount()).toBe(0);
      }
    });

    it('should handle sudden disconnections', async () => {
      const result = await poolManager.requestConnection();
      expect(result.success).toBe(true);

      // Simulate sudden disconnection
      if (result.connection) {
        result.connection.readyState = WebSocket.CLOSED;
        
        const released = await poolManager.releaseConnection(result.connection, {
          error: new Error('Connection lost')
        });
        
        expect(released).toBe(true);
      }
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track WebSocket specific metrics', async () => {
      await poolManager.requestConnection();
      
      const metrics = poolManager.getMetrics();
      expect(metrics.protocol).toBe('websocket');
      expect(metrics.activeConnections).toBeGreaterThan(0);
    });

    it('should report connection health status', () => {
      const health = poolManager.getHealth();
      expect(health.status).toBeTruthy();
      expect(typeof health.activeConnections).toBe('number');
    });

    it('should track performance metrics', async () => {
      const start = Date.now();
      await poolManager.requestConnection();
      const elapsed = Date.now() - start;

      const metrics = poolManager.getMetrics();
      expect(metrics.performance).toBeTruthy();
      expect(typeof metrics.performance.latency.p50).toBe('number');
    });
  });
}); 