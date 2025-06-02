/*
 * @Description: 健康检查和性能指标收集示例
 * @Usage: 演示如何使用统一的健康检查和指标收集功能
 * @Author: richen
 * @Date: 2024-11-27 18:30:00
 * @LastEditTime: 2024-11-27 18:30:00
 */

import { KoattyApplication } from 'koatty_core';
import { HttpServer } from '../src/server/http';
import { HttpsServer } from '../src/server/https';
import { WsServer } from '../src/server/ws';
import { GrpcServer } from '../src/server/grpc';
import Koa from 'koa';
import { 
  globalHealthHandler, 
  createHealthMiddleware,
  HealthEndpointsHandler 
} from '../src/utils/health-endpoints';
import { createServer } from 'http';

async function createHealthMonitoringExample() {
  console.log('🏥 健康检查和性能指标收集示例启动...\n');

  // 创建应用实例
  const app = new Koa();

  // 配置选项
  const baseConfig = {
    hostname: '127.0.0.1',
    ext: {
      healthCheck: {
        enabled: true,
        endpoint: '/health',
        interval: 15000, // 15 秒检查一次
        timeout: 3000,   // 3 秒超时
        checks: {
          connections: true,
          memory: true,
          dependencies: true
        }
      },
      metrics: {
        enabled: true,
        endpoint: '/metrics',
        interval: 5000,   // 5 秒收集一次
        retention: 300000 // 保留 5 分钟
      }
    }
  };

  // 创建多个协议服务器
  const servers: Array<{
    name: string;
    instance: HttpServer | HttpsServer | WsServer;
  }> = [
    {
      name: 'HTTP Server',
      instance: new HttpServer(app, {
        ...baseConfig,
        port: 3001,
        protocol: 'http'
      })
    },
    {
      name: 'HTTPS Server', 
      instance: new HttpsServer(app, {
        ...baseConfig,
        port: 3002,
        protocol: 'https',
        ext: {
          ...baseConfig.ext,
          key: './certs/server.key',
          cert: './certs/server.crt'
        }
      })
    },
    {
      name: 'WebSocket Server',
      instance: new WsServer(app, {
        ...baseConfig,
        port: 3003,
        protocol: 'ws',
        maxConnections: 100,
        connectionTimeout: 30000
      })
    }
  ];

  // 启动所有服务器并注册到健康监控
  console.log('📊 启动服务器并注册健康监控...');
  const startedServers: Array<{
    name: string;
    instance: HttpServer | HttpsServer | WsServer;
    serverId: string;
  }> = [];
  
  for (const { name, instance } of servers) {
    try {
      // 启动服务器
      instance.Start(() => {
        console.log(`✅ ${name} 启动成功 - 端口: ${instance.options.port}`);
      });

      // 注册到全局健康检查处理器
      const serverId = `${instance.protocol}_${instance.options.port}`;
      globalHealthHandler.registerServer(serverId, instance);
      
      startedServers.push({ name, instance, serverId });
      
      // 等待 500ms 避免端口冲突
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`❌ ${name} 启动失败:`, error);
    }
  }

  // 创建专用的健康检查和指标端点服务器
  console.log('\n🌐 启动健康检查和指标端点服务器...');
  const healthServer = createServer(createHealthMiddleware(globalHealthHandler));
  
  healthServer.listen(8080, '127.0.0.1', () => {
    console.log('✅ 健康检查和指标服务器启动成功 - 端口: 8080');
    console.log('\n📋 可用端点:');
    console.log('  🏥 健康检查: http://127.0.0.1:8080/health');
    console.log('  📊 性能指标: http://127.0.0.1:8080/metrics');
    console.log('  📈 Prometheus格式: http://127.0.0.1:8080/metrics?format=prometheus');
    console.log('  🖥️  服务器列表: http://127.0.0.1:8080/servers');
    console.log('  📝 详细健康检查: http://127.0.0.1:8080/health?detailed=true');
    console.log('\n🔍 查询特定服务器:');
    startedServers.forEach(({ serverId }) => {
      console.log(`     http://127.0.0.1:8080/health?server=${serverId}`);
    });
  });

  // 模拟一些请求和连接来生成指标
  console.log('\n🔄 启动模拟负载生成器...');
  startRequestSimulation();

  // 监听进程退出信号，执行优雅关闭
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  async function gracefulShutdown(signal: string) {
    console.log(`\n⚡ 接收到 ${signal} 信号，开始优雅关闭...`);
    
    // 关闭健康检查服务器
    healthServer.close();
    
    // 逐个关闭所有服务器
    for (const { name, instance } of startedServers) {
      try {
        console.log(`🔄 正在关闭 ${name}...`);
        await new Promise<void>((resolve, reject) => {
          instance.Stop((err) => {
            if (err) {
              console.error(`❌ ${name} 关闭失败:`, err);
              reject(err);
            } else {
              console.log(`✅ ${name} 已成功关闭`);
              resolve();
            }
          });
        });
      } catch (error) {
        console.error(`❌ ${name} 强制关闭:`, error);
      }
    }
    
    console.log('✅ 所有服务器已关闭，程序退出');
    process.exit(0);
  }
}

// 模拟请求负载生成器
function startRequestSimulation() {
  const endpoints = [
    'http://127.0.0.1:3001/',
    'http://127.0.0.1:8080/health',
    'http://127.0.0.1:8080/metrics'
  ];

  // 每隔 2-5 秒发送一些模拟请求
  setInterval(() => {
    const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    
    fetch(randomEndpoint)
      .then(response => {
        console.log(`📡 模拟请求: ${randomEndpoint} - 状态: ${response.status}`);
      })
      .catch(error => {
        console.log(`📡 模拟请求失败: ${randomEndpoint} - ${error.message}`);
      });
  }, Math.random() * 3000 + 2000);

  // 定期打印统计信息
  setInterval(() => {
    fetch('http://127.0.0.1:8080/servers')
      .then(response => response.json())
      .then(data => {
        console.log('\n📊 当前服务器状态:');
        data.servers.forEach((server: any) => {
          console.log(`  ${server.id}: ${server.healthStatus} (连接: ${server.activeConnections}, 运行时间: ${Math.floor(server.uptime/1000)}s)`);
        });
      })
      .catch(() => {
        // 忽略错误，可能是服务器还没准备好
      });
  }, 10000);
}

// 显示使用说明
function showUsageInstructions() {
  console.log(`
📚 健康检查和性能指标收集功能说明:

🏥 健康检查功能:
- 自动监控服务器状态、连接数、内存使用等
- 支持协议特定的健康检查 (HTTP/HTTPS/WebSocket/gRPC)
- 三种状态: healthy, degraded, unhealthy
- 可配置检查间隔和超时时间

📊 性能指标收集:
- 实时收集服务器性能数据
- 包含连接统计、请求统计、系统资源使用
- 支持历史数据保留和查询
- 兼容 Prometheus 监控格式

🛡️ 企业级特性:
- 统一的配置热重载 (无需重启即可更新非关键配置)
- 五步式优雅关闭 (保证数据完整性和连接安全)
- 结构化日志记录 (便于监控和故障排查)
- 多协议统一管理 (HTTP/HTTPS/HTTP2/gRPC/WebSocket)

🔧 配置示例:
{
  healthCheck: {
    enabled: true,
    interval: 30000,  // 30秒检查间隔
    timeout: 5000,    // 5秒超时
    checks: {
      connections: true,
      memory: true,
      dependencies: true
    }
  },
  metrics: {
    enabled: true,
    interval: 10000,   // 10秒收集间隔
    retention: 300000  // 5分钟数据保留
  }
}
`);
}

// 启动示例
if (require.main === module) {
  showUsageInstructions();
  createHealthMonitoringExample().catch(console.error);
}

export { createHealthMonitoringExample }; 