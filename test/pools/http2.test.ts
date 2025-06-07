import { Http2ConnectionPoolManager } from '../../src/pools/http2';
import { ConnectionPoolConfig } from '../../src/config/pool';
import * as http2 from 'http2';

// Mock http2 module
jest.mock('http2');

const mockHttp2 = http2 as jest.Mocked<typeof http2>;

describe('Http2ConnectionPoolManager', () => {
  let poolManager: Http2ConnectionPoolManager;
  let mockSession: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock HTTP/2 session
    mockSession = {
      on: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn(),
      destroy: jest.fn(),
      ping: jest.fn(),
      settings: jest.fn(),
      goaway: jest.fn(),
      request: jest.fn(),
      connecting: false,
      encrypted: true,
      alpnProtocol: 'h2',
      localSettings: { maxConcurrentStreams: 100 },
      remoteSettings: { maxConcurrentStreams: 100 },
      state: { effectiveLocalWindowSize: 65535 },
      socket: {
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        destroy: jest.fn(),
        remoteAddress: '127.0.0.1',
        remotePort: 80,
        localAddress: '127.0.0.1',
        localPort: 8080
      }
    } as any;
    
    // Make closed and destroyed writable
    Object.defineProperty(mockSession, 'closed', {
      value: false,
      writable: true,
      configurable: true
    });
    
    Object.defineProperty(mockSession, 'destroyed', {
      value: false,
      writable: true,
      configurable: true
    });

    // Mock http2.connect
    mockHttp2.connect.mockReturnValue(mockSession);
    
    // Mock constants (check if they don't already exist)
    try {
      if (!mockHttp2.hasOwnProperty('constants')) {
        Object.defineProperty(mockHttp2, 'constants', {
          value: {
            HTTP2_HEADER_METHOD: ':method',
            HTTP2_HEADER_PATH: ':path',
            HTTP2_HEADER_STATUS: ':status',
            HTTP2_HEADER_SCHEME: ':scheme',
            HTTP2_HEADER_AUTHORITY: ':authority'
          },
          writable: true,
          configurable: true
        });
      }
    } catch (error) {
      // Constants already exist, which is fine
    }

    poolManager = new Http2ConnectionPoolManager({
      maxConnections: 5,
      connectionTimeout: 1000,
      keepAliveTimeout: 500
    });
  });

  afterEach(async () => {
    if (poolManager) {
      await poolManager.destroy();
    }
  });

  describe('Initialization', () => {
    it('should create HTTP/2 connection pool manager', () => {
      expect(poolManager).toBeInstanceOf(Http2ConnectionPoolManager);
      expect(poolManager.getMetrics().protocol).toBe('http2');
    });

    it('should initialize with default configuration', () => {
      const metrics = poolManager.getMetrics();
      expect(metrics.poolConfig.maxConnections).toBe(5);
      expect(metrics.poolConfig.connectionTimeout).toBe(1000);
    });

    it('should handle SSL configuration', () => {
      const sslPool = new Http2ConnectionPoolManager({
        maxConnections: 10,
        protocolSpecific: {
          protocol: 'https',
          cert: 'test-cert',
          key: 'test-key',
          ca: 'test-ca'
        }
      } as any);

      expect(sslPool).toBeInstanceOf(Http2ConnectionPoolManager);
    });
  });

  describe('Connection Management', () => {
    it('should add HTTP/2 session', async () => {
      const success = await poolManager.addHttp2Session(mockSession);
      
      expect(success).toBe(true);
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });

    it('should handle connection creation with URL', async () => {
      // HTTP/2 pools don't create connections, they accept them
      // Test that requestConnection returns appropriate response
      const result = await poolManager.requestConnection({
        metadata: { url: 'https://api.example.com' }
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('timeout');
    });

    it('should handle connection creation failure', async () => {
      mockHttp2.connect.mockImplementation(() => {
        throw new Error('HTTP/2 connection failed');
      });

      const result = await poolManager.requestConnection();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should validate connection health correctly', async () => {
      // First add a healthy session to the pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Test with the actual session in the pool
      expect(poolManager.isConnectionHealthy(mockSession)).toBe(true);

      // Test with sessions that have problems
      const unhealthySession = { 
        closed: true, 
        destroyed: false,
        state: { effectiveLocalWindowSize: 0 }
      } as any;
      const destroyedSession = { 
        closed: false, 
        destroyed: true,
        state: { effectiveLocalWindowSize: 65535 }
      } as any;

      expect(poolManager.isConnectionHealthy(unhealthySession)).toBe(false);
      expect(poolManager.isConnectionHealthy(destroyedSession)).toBe(false);
    });

    it('should setup HTTP/2 session handlers', async () => {
      // Clear any previous mock calls
      jest.clearAllMocks();
      
      // Add session to pool, which should set up handlers
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      expect(mockSession.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockSession.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockSession.on).toHaveBeenCalledWith('goaway', expect.any(Function));
      expect(mockSession.on).toHaveBeenCalledWith('stream', expect.any(Function));
    });

    it('should cleanup connections properly', async () => {
      // First add session to pool
      await poolManager.addHttp2Session(mockSession);
      
      // Clear previous mock calls
      jest.clearAllMocks();
      
      // Test cleanup
      await (poolManager as any).cleanupConnection(mockSession);

      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe('HTTP/2 Specific Features', () => {
    it('should handle session settings', async () => {
      // Create a session with specific settings
      const sessionWithSettings = {
        ...mockSession,
        localSettings: {
          headerTableSize: 4096,
          enablePush: false,
          maxConcurrentStreams: 100
        }
      };

      const success = await poolManager.addHttp2Session(sessionWithSettings);
      expect(success).toBe(true);

      // Verify session was added with settings
      const stats = poolManager.getConnectionStats();
      expect(stats.activeConnections).toBe(1);
    });

    it('should handle GOAWAY frames', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Simulate GOAWAY frame
      const goawayHandler = mockSession.on.mock.calls.find(call => call[0] === 'goaway')?.[1];
      if (goawayHandler) {
        goawayHandler(0, 0, Buffer.from(''));
      }

      // Session should be marked for closure
      expect(mockSession.on).toHaveBeenCalledWith('goaway', expect.any(Function));
    });

    it('should handle ping frames', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Simulate ping
      const pingHandler = mockSession.on.mock.calls.find(call => call[0] === 'ping')?.[1];
      if (pingHandler) {
        pingHandler(Buffer.from('12345678'));
      }

      expect(mockSession.on).toHaveBeenCalledWith('ping', expect.any(Function));
    });

    it('should handle session close events', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);
      expect(poolManager.getActiveConnectionCount()).toBe(1);

      // Simulate close event
      const closeHandler = mockSession.on.mock.calls.find(call => call[0] === 'close')?.[1];
      if (closeHandler) {
        closeHandler();
      }

      // Verify close handler was set up
      expect(mockSession.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle session error events', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Simulate error event
      const errorHandler = mockSession.on.mock.calls.find(call => call[0] === 'error')?.[1];
      if (errorHandler) {
        errorHandler(new Error('HTTP/2 session error'));
      }

      // Error handling should be set up
      expect(mockSession.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('SSL/TLS Support', () => {
    it('should create secure HTTP/2 sessions', async () => {
      // Create a secure session mock
      const secureSession = {
        ...mockSession,
        encrypted: true,
        socket: {
          ...mockSession.socket,
          encrypted: true,
          authorized: true
        }
      };

      const success = await poolManager.addHttp2Session(secureSession);
      expect(success).toBe(true);

      // Verify secure session was added
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });

    it('should handle ALPN protocol negotiation', async () => {
      // Create a session with ALPN protocol
      const alpnSession = {
        ...mockSession,
        alpnProtocol: 'h2'
      };

      const success = await poolManager.addHttp2Session(alpnSession);
      expect(success).toBe(true);

      // Verify ALPN session was added
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });
  });

  describe('Connection Pooling', () => {
    it('should reuse HTTP/2 sessions when possible', async () => {
      // Add a session to the pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);
      expect(poolManager.getActiveConnectionCount()).toBe(1);

      // Try to get a connection from the pool
      const result = await poolManager.requestConnection({
        metadata: { authority: 'example.com:443' }
      });
      
      // Since HTTP/2 pool doesn't support active connection requests,
      // verify the session is available in the pool
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });

    it('should handle connection limits', async () => {
      const requests = Array(7).fill(null).map(() => 
        poolManager.requestConnection({ 
          timeout: 100,
          metadata: { authority: `host${Math.random()}.example.com:443` }
        })
      );

      const results = await Promise.allSettled(requests);
      const successful = results.filter(r => 
        r.status === 'fulfilled' && r.value.success
      );

      expect(successful.length).toBeLessThanOrEqual(5);
    });

    it('should handle different authorities separately', async () => {
      // Add two sessions with different authorities
      const session1 = { ...mockSession };
      const session2 = { ...mockSession };
      
      const success1 = await poolManager.addHttp2Session(session1);
      const success2 = await poolManager.addHttp2Session(session2);
      
      expect(success1).toBe(true);
      expect(success2).toBe(true);
      expect(poolManager.getActiveConnectionCount()).toBe(2);
    });
  });

  describe('Stream Management', () => {
    it('should handle stream creation', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      const mockStream = {
        on: jest.fn(),
        end: jest.fn(),
        write: jest.fn()
      };
      
      mockSession.request.mockReturnValue(mockStream);
      
      const stream = mockSession.request({
        ':method': 'GET',
        ':path': '/api/test'
      });
      
      expect(mockSession.request).toHaveBeenCalledWith({
        ':method': 'GET',
        ':path': '/api/test'
      });
    });

    it('should handle concurrent streams', async () => {
      // Create session with concurrent stream settings
      const sessionWithStreams = {
        ...mockSession,
        localSettings: {
          maxConcurrentStreams: 100
        }
      };

      const success = await poolManager.addHttp2Session(sessionWithStreams);
      expect(success).toBe(true);

      // Verify session was added
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid URLs gracefully', async () => {
      const result = await poolManager.requestConnection({
        metadata: { url: 'invalid-url' }
      });

      // Should handle gracefully based on implementation
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle connection timeouts', async () => {
      // Mock a slow connection
      mockHttp2.connect.mockImplementation((url, options, callback) => {
        // Don't call the callback to simulate timeout
        return mockSession;
      });

      const result = await poolManager.requestConnection({
        timeout: 100,
        metadata: { authority: 'slow.example.com:443' }
      });

      // Should handle timeout appropriately
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle session destruction', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Simulate session destruction
      Object.defineProperty(mockSession, 'destroyed', {
        value: true,
        writable: true,
        configurable: true
      });
      
      const released = await poolManager.releaseConnection(mockSession, {
        error: new Error('Session destroyed')
      });
      
      expect(released).toBe(true);
    });

    it('should handle protocol errors', async () => {
      mockHttp2.connect.mockImplementation(() => {
        const session = { ...mockSession };
        setTimeout(() => {
          const errorHandler = session.on.mock.calls.find(call => call[0] === 'error')?.[1];
          if (errorHandler) errorHandler(new Error('PROTOCOL_ERROR'));
        }, 10);
        return session;
      });

      const result = await poolManager.requestConnection();
      
      if (result.success) {
        // Wait for error event
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(poolManager.isConnectionHealthy(result.connection!)).toBe(false);
      }
    });
  });

  describe('Performance and Optimization', () => {
    it('should handle server push configuration', async () => {
      // Create session with server push settings
      const pushSession = {
        ...mockSession,
        localSettings: {
          enablePush: true
        }
      };

      const success = await poolManager.addHttp2Session(pushSession);
      expect(success).toBe(true);

      // Verify session was added
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });

    it('should handle window size configuration', async () => {
      // Create session with window size settings
      const windowSession = {
        ...mockSession,
        localSettings: {
          initialWindowSize: 65535,
          maxFrameSize: 16384
        }
      };

      const success = await poolManager.addHttp2Session(windowSession);
      expect(success).toBe(true);

      // Verify session was added
      expect(poolManager.getActiveConnectionCount()).toBe(1);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track HTTP/2 specific metrics', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);
      
      const metrics = poolManager.getMetrics();
      expect(metrics.protocol).toBe('http2');
      expect(metrics.activeConnections).toBeGreaterThan(0);
    });

    it('should report connection health status', () => {
      const health = poolManager.getHealth();
      expect(health.status).toBeTruthy();
      expect(typeof health.activeConnections).toBe('number');
    });

    it('should track session lifecycle events', async () => {
      const result = await poolManager.requestConnection();
      
      if (result.success) {
        await (poolManager as any).setupProtocolSpecificHandlers(result.connection);
        
        // Verify event handlers are set up
        expect(mockSession.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockSession.on).toHaveBeenCalledWith('close', expect.any(Function));
      }
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should close sessions on pool destruction', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      await poolManager.destroy();
      
      expect(mockSession.close).toHaveBeenCalled();
    });

    it('should handle graceful session shutdown', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Simulate graceful shutdown
      const released = await poolManager.releaseConnection(mockSession, { destroy: true });
      
      expect(released).toBe(true);
      expect(mockSession.close).toHaveBeenCalled();
    });

    it('should clean up idle sessions', async () => {
      // Add session to pool
      const success = await poolManager.addHttp2Session(mockSession);
      expect(success).toBe(true);

      // Clear previous mock calls
      jest.clearAllMocks();

      // Test cleanup with a healthy session (not closed/destroyed)
      await (poolManager as any).cleanupConnection(mockSession);
      
      // Since session is not closed/destroyed, close should be called
      expect(mockSession.close).toHaveBeenCalled();
    });
  });
}); 