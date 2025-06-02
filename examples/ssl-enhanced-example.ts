/*
 * @Description: SSL/TLS增强功能示例
 * @Usage: 演示如何使用增强的SSL/TLS配置功能
 * @Author: richen
 * @Date: 2024-11-27 18:00:00
 * @LastEditTime: 2024-11-27 18:00:00
 */

import { KoattyApplication } from 'koatty_core';
import { HttpsServer, HttpsServerOptions } from '../src/server/https';
import { GrpcServer, GrpcServerOptions } from '../src/server/grpc';
import { createLogger } from '../src/utils/structured-logger';

const logger = createLogger({ module: 'ssl-example' });

async function demonstrateSSLEnhancements() {
  console.log('🔐 SSL/TLS增强功能演示启动...\n');

  // 创建应用实例
  const app = new KoattyApplication();

  // ============= HTTPS服务器SSL增强示例 =============
  
  console.log('📊 1. HTTPS服务器 - 多种SSL安全模式演示');

  // 1.1 自动SSL模式 (推荐用于生产环境)
  const httpsAutoConfig: HttpsServerOptions = {
    hostname: '127.0.0.1',
    port: 8443,
    protocol: 'https',
    ssl: {
      mode: 'auto',
      key: './certs/server.key',
      cert: './certs/server.crt'
    },
    connectionPool: {
      keepAliveTimeout: 5000,
      headersTimeout: 10000,
      requestTimeout: 30000
    },
    ext: {
      healthCheck: {
        enabled: true,
        interval: 30000
      },
      metrics: {
        enabled: true,
        interval: 10000
      }
    }
  };

  // 1.2 手动SSL模式 (适用于自定义配置)
  const httpsManualConfig: HttpsServerOptions = {
    hostname: '127.0.0.1',
    port: 8444,
    protocol: 'https',
    ssl: {
      mode: 'manual',
      key: './certs/server.key',
      cert: './certs/server.crt',
      ca: './certs/ca.crt',
      ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:!RC4:!LOW:!MD5:!aNULL:!EDH',
      honorCipherOrder: true,
      secureProtocol: 'TLSv1_2_method'
    }
  };

  // 1.3 双向TLS模式 (最高安全级别)
  const httpsMutualTLSConfig: HttpsServerOptions = {
    hostname: '127.0.0.1',
    port: 8445,
    protocol: 'https',
    ssl: {
      mode: 'mutual_tls',
      key: './certs/server.key',
      cert: './certs/server.crt',
      ca: './certs/ca.crt',
      requestCert: true,
      rejectUnauthorized: true
    }
  };

  // ============= gRPC服务器SSL增强示例 =============
  
  console.log('📊 2. gRPC服务器 - 完整SSL/TLS连接池配置');

  // 2.1 生产级gRPC SSL配置
  const grpcProductionConfig: GrpcServerOptions = {
    hostname: '127.0.0.1',
    port: 50051,
    protocol: 'grpc',
    ssl: {
      enabled: true,
      keyFile: './certs/server.key',
      certFile: './certs/server.crt',
      caFile: './certs/ca.crt',
      clientCertRequired: false
    },
    connectionPool: {
      maxConnections: 100,
      keepAliveTime: 30000,
      keepAliveTimeout: 5000,
      maxReceiveMessageLength: 4 * 1024 * 1024,
      maxSendMessageLength: 4 * 1024 * 1024
    },
    ext: {
      healthCheck: {
        enabled: true,
        interval: 15000
      },
      metrics: {
        enabled: true,
        interval: 5000
      }
    }
  };

  // 2.2 高安全级gRPC双向TLS配置
  const grpcMutualTLSConfig: GrpcServerOptions = {
    hostname: '127.0.0.1',
    port: 50052,
    protocol: 'grpc',
    ssl: {
      enabled: true,
      keyFile: './certs/server.key',
      certFile: './certs/server.crt',
      caFile: './certs/ca.crt',
      clientCertRequired: true
    },
    connectionPool: {
      maxConnections: 50,
      keepAliveTime: 60000,
      keepAliveTimeout: 10000
    }
  };

  // ============= 启动服务器演示 =============

  console.log('\n🚀 启动增强SSL服务器...');

  try {
    // 启动HTTPS服务器 (自动SSL模式)
    const httpsAutoServer = new HttpsServer(app, httpsAutoConfig);
    httpsAutoServer.Start(() => {
      console.log('✅ HTTPS服务器 (自动SSL) 启动成功 - 端口: 8443');
      console.log('   🔐 SSL模式: auto');
      console.log('   🛡️ 连接池: 已配置');
      console.log('   🏥 健康检查: 已启用');
    });

    // 演示配置热重载
    setTimeout(async () => {
      console.log('\n🔄 演示SSL配置热重载...');
      
      const updated = await httpsAutoServer.updateConfig({
        ssl: {
          mode: 'manual',
          ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:!RC4:!LOW:!MD5'
        }
      });

      if (updated) {
        console.log('✅ SSL配置已热重载 (触发优雅重启)');
      } else {
        console.log('⚠️ SSL配置无需重启，已实时应用');
      }
    }, 3000);

    // 启动gRPC服务器 (生产级配置)
    const grpcProductionServer = new GrpcServer(app, grpcProductionConfig);
    grpcProductionServer.Start(() => {
      console.log('✅ gRPC服务器 (生产级SSL) 启动成功 - 端口: 50051');
      console.log('   🔐 SSL模式: one_way_tls');
      console.log('   🔗 连接池: 最大100连接');
      console.log('   📊 性能监控: 已启用');
    });

    // 演示连接池配置更新
    setTimeout(async () => {
      console.log('\n⚡ 演示gRPC连接池配置更新...');
      
      const updated = await grpcProductionServer.updateConfig({
        connectionPool: {
          maxConnections: 200,
          keepAliveTime: 45000
        }
      });

      console.log('✅ gRPC连接池配置已更新:', updated ? '需要重启' : '实时应用');
    }, 5000);

    // 监控SSL连接状态
    setTimeout(() => {
      console.log('\n📈 SSL连接状态监控:');
      
      // HTTPS服务器状态
      const httpsHealth = httpsAutoServer.getHealthStatus();
      console.log('  HTTPS服务器:');
      console.log(`    状态: ${httpsHealth?.status || 'unknown'}`);
      console.log(`    SSL检查: ${httpsHealth?.checks?.ssl?.status || 'unknown'}`);
      console.log(`    活跃连接: ${httpsAutoServer.getActiveConnectionCount()}`);

      // gRPC服务器状态
      const grpcHealth = grpcProductionServer.getHealthStatus();
      const grpcStats = grpcProductionServer.getConnectionStats();
      console.log('  gRPC服务器:');
      console.log(`    状态: ${grpcHealth?.status || 'unknown'}`);
      console.log(`    连接池: ${grpcStats?.activeConnections}/${grpcProductionConfig.connectionPool?.maxConnections}`);
      console.log(`    总连接数: ${grpcStats?.totalConnections}`);
    }, 7000);

    // 演示优雅关闭
    setTimeout(async () => {
      console.log('\n🛡️ 演示优雅关闭流程...');
      
      console.log('正在优雅关闭HTTPS服务器...');
      await httpsAutoServer.gracefulShutdown({
        timeout: 10000,
        drainDelay: 2000
      });
      console.log('✅ HTTPS服务器已优雅关闭');

      console.log('正在优雅关闭gRPC服务器...');
      await grpcProductionServer.gracefulShutdown({
        timeout: 15000,
        drainDelay: 3000
      });
      console.log('✅ gRPC服务器已优雅关闭');

      console.log('\n🎉 SSL/TLS增强功能演示完成!');
      process.exit(0);
    }, 10000);

  } catch (error) {
    console.error('❌ SSL服务器启动失败:', error);
    process.exit(1);
  }
}

// 显示SSL/TLS增强功能说明
function showSSLEnhancementFeatures() {
  console.log(`
🔐 SSL/TLS增强功能特性:

📊 多种安全模式:
  • auto     - 自动检测证书配置 (推荐生产环境)
  • manual   - 手动精确配置 (适用于复杂场景)
  • mutual_tls - 双向TLS认证 (最高安全级别)

🛡️ 安全配置选项:
  • 证书文件路径或内容直接配置
  • 自定义密码套件和协议版本
  • CA证书验证和客户端证书要求
  • 密码顺序优先级和安全协议选择

⚡ 性能优化:
  • 连接池管理和复用
  • Keep-Alive超时配置
  • 头部和请求超时设置
  • 消息大小限制配置

🔄 配置热重载:
  • 智能检测SSL配置变更
  • 自动判断是否需要重启
  • 优雅重启保证服务连续性
  • 实时应用非关键配置

🏥 监控和健康检查:
  • SSL证书状态监控
  • 连接池统计和性能指标
  • 协议特定的健康检查
  • 实时连接状态追踪

🛠️ 企业级特性:
  • 详细的SSL事件日志记录
  • TLS错误处理和恢复
  • 安全连接建立监控
  • 证书过期检测和告警

📝 配置示例:

HTTPS 自动SSL模式:
{
  ssl: {
    mode: 'auto',
    key: './certs/server.key',
    cert: './certs/server.crt'
  },
  connectionPool: {
    keepAliveTimeout: 5000,
    headersTimeout: 10000
  }
}

gRPC 生产级配置:
{
  ssl: {
    enabled: true,
    keyFile: './certs/server.key',
    certFile: './certs/server.crt',
    caFile: './certs/ca.crt'
  },
  connectionPool: {
    maxConnections: 100,
    keepAliveTime: 30000,
    keepAliveTimeout: 5000
  }
}

双向TLS配置:
{
  ssl: {
    mode: 'mutual_tls',
    key: './certs/server.key',
    cert: './certs/server.crt',
    ca: './certs/ca.crt',
    requestCert: true,
    rejectUnauthorized: true
  }
}
`);
}

// 启动示例
if (require.main === module) {
  showSSLEnhancementFeatures();
  demonstrateSSLEnhancements().catch(console.error);
}

export { demonstrateSSLEnhancements }; 