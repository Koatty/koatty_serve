/*
 * @Description: 健康检查和性能指标收集测试
 * @Usage: 
 * @Author: richen
 * @Date: 2024-11-27 18:30:00
 * @LastEditTime: 2024-11-27 18:30:00
 */

import { HttpServer } from '../src/server/http';
import { HttpsServer } from '../src/server/https';
import { HealthEndpointsHandler } from '../src/utils/health-endpoints';
import { HealthStatus } from '../src/server/base';

// Mock KoattyApplication
const mockApp = {
  callback: () => (req: any, res: any) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello World');
  }
} as any;

describe('健康检查和性能指标收集', () => {
  let httpServer: HttpServer;
  let httpsServer: HttpsServer;
  let healthHandler: HealthEndpointsHandler;

  beforeEach(() => {
    healthHandler = new HealthEndpointsHandler();
    
    httpServer = new HttpServer(mockApp, {
      hostname: '127.0.0.1',
      port: 0, // Use 0 to get random available port
      protocol: 'http',
      ext: {
        healthCheck: {
          enabled: true,
          interval: 1000,
          timeout: 500,
          checks: {
            connections: true,
            memory: true
          }
        },
        metrics: {
          enabled: true,
          interval: 500,
          retention: 5000
        }
      }
    });

    httpsServer = new HttpsServer(mockApp, {
      hostname: '127.0.0.1',
      port: 0,
      protocol: 'https',
      ext: {
        key: 'mock-key',
        cert: 'mock-cert',
        healthCheck: {
          enabled: true,
          interval: 1000,
          timeout: 500
        },
        metrics: {
          enabled: true,
          interval: 500
        }
      }
    });
  });

  afterEach(async () => {
    // Clean up servers
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.Stop(() => resolve());
      });
    }
    if (httpsServer) {
      await new Promise<void>((resolve) => {
        httpsServer.Stop(() => resolve());
      });
    }
  });

  describe('健康检查功能', () => {
    it('应该能够获取基础健康状态', async () => {
      // Start the server
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Register with health handler
      healthHandler.registerServer('http_test', httpServer);

      // Wait for health check to run
      await new Promise(resolve => setTimeout(resolve, 1200));

      const healthStatus = httpServer.getHealthStatus();
      
      expect(healthStatus).toBeTruthy();
      expect(healthStatus?.status).toBe(HealthStatus.HEALTHY);
      expect(healthStatus?.timestamp).toBeGreaterThan(0);
      expect(healthStatus?.uptime).toBeGreaterThan(0);
      expect(healthStatus?.checks).toBeDefined();
    });

    it('应该包含连接健康检查', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for health check to run
      await new Promise(resolve => setTimeout(resolve, 1200));

      const healthStatus = httpServer.getHealthStatus();
      
      expect(healthStatus?.checks.connections).toBeDefined();
      expect(healthStatus?.checks.connections.status).toBe(HealthStatus.HEALTHY);
      expect(healthStatus?.checks.connections.details).toBeDefined();
    });

    it('应该包含内存健康检查', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for health check to run
      await new Promise(resolve => setTimeout(resolve, 1200));

      const healthStatus = httpServer.getHealthStatus();
      
      expect(healthStatus?.checks.memory).toBeDefined();
      expect(healthStatus?.checks.memory.status).toBeDefined();
      expect(healthStatus?.checks.memory.details?.memoryUsage).toBeDefined();
    });

    it('应该包含协议特定的健康检查', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for health check to run
      await new Promise(resolve => setTimeout(resolve, 1200));

      const healthStatus = httpServer.getHealthStatus();
      
      // Should include protocol-specific checks from performProtocolHealthChecks
      expect(healthStatus?.checks.server).toBeDefined();
      expect(healthStatus?.checks.server.status).toBe(HealthStatus.HEALTHY);
      expect(healthStatus?.checks.server.details?.listening).toBe(true);
    });
  });

  describe('性能指标收集', () => {
    it('应该能够收集基础性能指标', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for metrics collection to run
      await new Promise(resolve => setTimeout(resolve, 600));

      const metrics = httpServer.getPerformanceMetrics();
      
      expect(metrics).toBeTruthy();
      expect(metrics?.uptime).toBeGreaterThan(0);
      expect(metrics?.memoryUsage).toBeDefined();
      expect(metrics?.cpuUsage).toBeDefined();
      expect(metrics?.connections).toBeDefined();
      expect(metrics?.requests).toBeDefined();
      expect(metrics?.performance).toBeDefined();
      expect(metrics?.custom).toBeDefined();
    });

    it('应该跟踪请求统计', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate some requests
      httpServer.recordRequest(true, 150);
      httpServer.recordRequest(true, 200);
      httpServer.recordRequest(false, 500);

      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 600));

      const metrics = httpServer.getPerformanceMetrics();
      
      expect(metrics?.requests.total).toBe(3);
      expect(metrics?.requests.successful).toBe(2);
      expect(metrics?.requests.failed).toBe(1);
      expect(metrics?.requests.averageResponseTime).toBeGreaterThan(0);
    });

    it('应该保存指标历史记录', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for multiple metrics collections
      await new Promise(resolve => setTimeout(resolve, 1200));

      const history = httpServer.getMetricsHistory();
      
      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('应该包含协议特定的指标', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 600));

      const metrics = httpServer.getPerformanceMetrics();
      
      expect(metrics?.custom).toBeDefined();
      expect(metrics?.custom.protocol).toBe('http');
      expect(metrics?.custom.server).toBeDefined();
    });
  });

  describe('HTTPS 服务器健康检查', () => {
    it('应该包含 SSL 证书检查', async () => {
      httpsServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for health check to run
      await new Promise(resolve => setTimeout(resolve, 1200));

      const healthStatus = httpsServer.getHealthStatus();
      
      expect(healthStatus?.checks.ssl).toBeDefined();
      expect(healthStatus?.checks.ssl.status).toBe(HealthStatus.HEALTHY);
      expect(healthStatus?.checks.ssl.details?.keyConfigured).toBe(true);
      expect(healthStatus?.checks.ssl.details?.certConfigured).toBe(true);
    });
  });

  describe('健康端点处理器', () => {
    it('应该能够注册和注销服务器', () => {
      const serverId = 'test_server';
      
      healthHandler.registerServer(serverId, httpServer);
      expect(healthHandler.serverCount).toBe(1);

      healthHandler.unregisterServer(serverId);
      expect(healthHandler.serverCount).toBe(0);
    });

    it('应该处理健康检查请求', async () => {
      const mockReq = {
        url: '/health',
        headers: { host: 'localhost' }
      } as any;

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      } as any;

      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      healthHandler.registerServer('http_test', httpServer);
      await new Promise(resolve => setTimeout(resolve, 1200));

      await healthHandler.handleHealthCheck(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalled();
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('应该处理指标请求', async () => {
      const mockReq = {
        url: '/metrics',
        headers: { host: 'localhost' }
      } as any;

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      } as any;

      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      healthHandler.registerServer('http_test', httpServer);
      await new Promise(resolve => setTimeout(resolve, 600));

      await healthHandler.handleMetrics(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalled();
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('配置热重载集成', () => {
    it('应该在配置更新时保持健康检查状态', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // 获取初始健康状态
      await new Promise(resolve => setTimeout(resolve, 1200));
      const initialHealth = httpServer.getHealthStatus();
      expect(initialHealth?.status).toBe(HealthStatus.HEALTHY);

      // 更新运行时配置
      const updated = await httpServer.updateConfig({
        ext: {
          healthCheck: {
            enabled: true,
            interval: 2000 // 改变检查间隔
          }
        }
      });

      expect(updated).toBe(true);

      // 健康检查应该继续工作
      await new Promise(resolve => setTimeout(resolve, 2200));
      const updatedHealth = httpServer.getHealthStatus();
      expect(updatedHealth?.status).toBe(HealthStatus.HEALTHY);
    });
  });

  describe('优雅关闭与监控清理', () => {
    it('应该在优雅关闭时停止监控', async () => {
      httpServer.Start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // 等待监控启动
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const initialMetrics = httpServer.getPerformanceMetrics();
      expect(initialMetrics).toBeTruthy();

      // 执行优雅关闭
      await httpServer.gracefulShutdown();

      // 监控应该已停止
      // 注意：这里我们主要测试关闭过程没有抛出错误
      expect(httpServer.getStatus()).toBeDefined();
    });
  });
});

// 扩展 HealthEndpointsHandler 以便测试
declare module '../src/utils/health-endpoints' {
  interface HealthEndpointsHandler {
    serverCount: number;
  }
}

// 添加 serverCount getter
Object.defineProperty(HealthEndpointsHandler.prototype, 'serverCount', {
  get: function() {
    return (this as any).servers.size;
  }
}); 