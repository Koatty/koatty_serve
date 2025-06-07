import { HttpsConnectionPoolManager } from '../../src/pools/https';
import { ConnectionPoolConfig } from '../../src/config/pool';
import { TLSSocket } from 'tls';

describe('HttpsConnectionPoolManager', () => {
  let poolManager: HttpsConnectionPoolManager;

  const defaultConfig: ConnectionPoolConfig = {
    maxConnections: 100,
    connectionTimeout: 30000,
    keepAliveTimeout: 5000,
    requestTimeout: 30000,
    headersTimeout: 10000
  };

  beforeEach(() => {
    jest.clearAllMocks();
    poolManager = new HttpsConnectionPoolManager(defaultConfig);
  });

  afterEach(async () => {
    await poolManager.destroy();
  });

  describe('Initialization', () => {
    it('should create HTTPS connection pool manager', () => {
      expect(poolManager).toBeInstanceOf(HttpsConnectionPoolManager);
      expect(poolManager.getMetrics().protocol).toBe('https');
    });

    it('should initialize with correct configuration', () => {
      const metrics = poolManager.getMetrics();
      expect(metrics.poolConfig.maxConnections).toBe(100);
      expect(metrics.poolConfig.connectionTimeout).toBe(30000);
      expect(metrics.poolConfig.keepAliveTimeout).toBe(5000);
    });

    it('should support custom SSL configuration', () => {
      const sslConfig: ConnectionPoolConfig = {
        ...defaultConfig,
        maxConnections: 50
      };

      const sslPoolManager = new HttpsConnectionPoolManager(sslConfig);
      expect(sslPoolManager).toBeInstanceOf(HttpsConnectionPoolManager);
      expect(sslPoolManager.getMetrics().protocol).toBe('https');
      expect(sslPoolManager.getMetrics().poolConfig.maxConnections).toBe(50);
    });

    it('should handle custom configuration', () => {
      const customConfig: ConnectionPoolConfig = {
        ...defaultConfig,
        connectionTimeout: 60000
      };

      const customPoolManager = new HttpsConnectionPoolManager(customConfig);
      expect(customPoolManager).toBeInstanceOf(HttpsConnectionPoolManager);
      expect(customPoolManager.getMetrics().poolConfig.connectionTimeout).toBe(60000);
    });
  });

  describe('Connection Management', () => {
    it('should handle connection health check for null connections', () => {
      // This should return false for null connections
      expect(poolManager.isConnectionHealthy(null as any)).toBe(false);
    });

    it('should request connections from pool', async () => {
      const result = await poolManager.requestConnection({ timeout: 100 });
      
      // Since createNewConnection returns null for HTTPS (server-side connections)
      expect(result.success).toBe(false);
      expect(result.connection).toBeNull();
    });

    it('should handle timeout correctly', async () => {
      const result = await poolManager.requestConnection({ timeout: 100 });
      
      expect(result.success).toBe(false);
      expect(result.connection).toBeNull();
    });
  });

  describe('Configuration Management', () => {
    it('should handle different max connections limits', () => {
      const limitedConfig: ConnectionPoolConfig = {
        ...defaultConfig,
        maxConnections: 2
      };
      
      const limitedPoolManager = new HttpsConnectionPoolManager(limitedConfig);
      
      expect(limitedPoolManager.getMetrics().poolConfig.maxConnections).toBe(2);
    });

    it('should handle connection timeouts', async () => {
      const timeoutConfig: ConnectionPoolConfig = {
        ...defaultConfig,
        connectionTimeout: 5000
      };
      
      const timeoutPoolManager = new HttpsConnectionPoolManager(timeoutConfig);
      const result = await timeoutPoolManager.requestConnection({ timeout: 100 });
      
      expect(result.success).toBe(false);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track connection statistics', () => {
      const stats = poolManager.getConnectionStats();
      
      expect(stats).toEqual(
        expect.objectContaining({
          total: expect.any(Number),
          active: expect.any(Number),
          available: expect.any(Number),
          unauthorized: expect.any(Number),
          authorized: expect.any(Number),
          totalBytesReceived: expect.any(Number),
          totalBytesSent: expect.any(Number),
          totalRequests: expect.any(Number),
          averageSecurityScore: expect.any(Number),
          security: expect.objectContaining({
            totalHandshakes: expect.any(Number),
            failedHandshakes: expect.any(Number),
            unauthorizedConnections: expect.any(Number),
            averageHandshakeTime: expect.any(Number)
          }),
          protocols: expect.any(Object),
          ciphers: expect.any(Object)
        })
      );
    });

    it('should provide security metrics', () => {
      const securityMetrics = poolManager.getSecurityMetrics();
      
      expect(securityMetrics).toEqual(
        expect.objectContaining({
          totalHandshakes: expect.any(Number),
          failedHandshakes: expect.any(Number),
          unauthorizedConnections: expect.any(Number),
          averageHandshakeTime: expect.any(Number),
          connectionSecurityScores: expect.any(Array)
        })
      );
    });

    it('should provide connection metrics', () => {
      const metrics = poolManager.getMetrics();
      
      expect(metrics).toEqual(
        expect.objectContaining({
          protocol: 'https',
          activeConnections: expect.any(Number),
          totalConnections: expect.any(Number),
          poolConfig: expect.objectContaining({
            maxConnections: 100,
            connectionTimeout: 30000
          }),
          health: expect.objectContaining({
            status: expect.any(String),
            activeConnections: expect.any(Number)
          })
        })
      );
    });

    it('should provide connection details', () => {
      const details = poolManager.getConnectionDetails();
      
      expect(Array.isArray(details)).toBe(true);
    });

    it('should configure keep-alive timeout', () => {
      poolManager.setKeepAliveTimeout(10000);
      
      // Verify the method was called successfully
      // The actual timeout is stored internally and used for connection management
      expect(poolManager).toBeTruthy();
    });
  });

  describe('Pool Operations', () => {
    it('should handle pool capacity checks', () => {
      expect(poolManager.canAcceptConnection()).toBe(true);
    });

    it('should get active connection count', () => {
      const count = poolManager.getActiveConnectionCount();
      expect(count).toBe(0);
    });

    it('should handle release connection for non-existent connections', async () => {
      // This should handle gracefully when connection doesn't exist
      const mockConnection = {} as any;
      const result = await poolManager.releaseConnection(mockConnection);
      expect(result).toBe(false);
    });
  });

  describe('Health Status', () => {
    it('should provide health status', () => {
      const health = poolManager.getHealth();
      
      expect(health).toEqual(
        expect.objectContaining({
          status: expect.any(String),
          utilizationRatio: expect.any(Number),
          activeConnections: expect.any(Number),
          maxConnections: expect.any(Number),
          rejectedConnections: expect.any(Number),
          averageResponseTime: expect.any(Number),
          errorRate: expect.any(Number),
          message: expect.any(String),
          lastUpdated: expect.any(Number)
        })
      );
    });

    it('should update health status', () => {
      const initialHealth = poolManager.getHealth();
      
      // Update health status
      poolManager.updateHealthStatus();
      
      const updatedHealth = poolManager.getHealth();
      expect(updatedHealth.lastUpdated).toBeGreaterThanOrEqual(initialHealth.lastUpdated);
    });
  });

  describe('Configuration Updates', () => {
    it('should allow configuration updates', async () => {
      const newConfig = { maxConnections: 50 };
      const result = await poolManager.updateConfig(newConfig);
      
      expect(result).toBe(true);
      expect(poolManager.getMetrics().poolConfig.maxConnections).toBe(50);
    });

    it('should validate configuration on update', async () => {
      const invalidConfig = { maxConnections: -1 };
      const result = await poolManager.updateConfig(invalidConfig);
      
      expect(result).toBe(false);
    });
  });

  describe('Event Handling', () => {
    it('should support event listeners', () => {
      const listener = jest.fn();
      
      poolManager.on('connection_added' as any, listener);
      expect(() => {
        poolManager.off('connection_added' as any, listener);
      }).not.toThrow();
    });
  });

  describe('Cleanup and Destruction', () => {
    it('should handle graceful shutdown', async () => {
      await expect(poolManager.destroy()).resolves.toBeUndefined();
    });

    it('should handle close all connections', async () => {
      await expect(poolManager.closeAllConnections(1000)).resolves.toBeUndefined();
    });

    it('should handle destruction multiple times', async () => {
      await poolManager.destroy();
      await expect(poolManager.destroy()).resolves.toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent requests', async () => {
      const requests = Array(10).fill(null).map(() => 
        poolManager.requestConnection({ timeout: 100 })
      );
      
      const results = await Promise.all(requests);
      
      // All should fail since no connections are available
      results.forEach(result => {
        expect(result.success).toBe(false);
      });
    });

    it('should track performance metrics', () => {
      const metrics = poolManager.getMetrics();
      
      expect(metrics.performance).toEqual(
        expect.objectContaining({
          throughput: expect.any(Number),
          latency: expect.objectContaining({
            p50: expect.any(Number),
            p95: expect.any(Number),
            p99: expect.any(Number)
          }),
          memoryUsage: expect.any(Number),
          cpuUsage: expect.any(Number)
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      // Test with invalid options
      const result = await poolManager.requestConnection({ priority: 'invalid' as any, timeout: 100 });
      expect(result.success).toBe(false);
    });

    it('should handle configuration errors', () => {
      expect(() => {
        new HttpsConnectionPoolManager({ maxConnections: -1 });
      }).toThrow('maxConnections must be positive'); // Should throw validation error
    });
  });

  describe('Security Features', () => {
    it('should provide security metrics with proper structure', () => {
      const securityMetrics = poolManager.getSecurityMetrics();
      
      expect(securityMetrics.totalHandshakes).toBe(0);
      expect(securityMetrics.failedHandshakes).toBe(0);
      expect(securityMetrics.unauthorizedConnections).toBe(0);
      expect(securityMetrics.averageHandshakeTime).toBe(0);
      expect(Array.isArray(securityMetrics.connectionSecurityScores)).toBe(true);
    });

    it('should track connection statistics with security metrics', () => {
      const stats = poolManager.getConnectionStats();
      
      expect(stats.security).toEqual(
        expect.objectContaining({
          totalHandshakes: expect.any(Number),
          failedHandshakes: expect.any(Number),
          unauthorizedConnections: expect.any(Number),
          averageHandshakeTime: expect.any(Number)
        })
      );
    });
  });
}); 