/*
 * @Description: HTTP/2增强功能示例
 * @Usage: 演示如何使用增强的HTTP/2 SSL/TLS配置和监控功能
 * @Author: richen
 * @Date: 2024-11-27 18:30:00
 * @LastEditTime: 2024-11-27 18:30:00
 */

import { KoattyApplication } from 'koatty_core';
import { Http2Server, Http2ServerOptions } from '../src/server/http2';
import { createLogger } from '../src/utils/structured-logger';

const logger = createLogger({ module: 'http2-example' });

async function demonstrateHTTP2Enhancements() {
  console.log('🚀 HTTP/2增强功能演示启动...\n');

  // 创建应用实例 - 使用 new 创建实例而不是作为类型
  const app = {} as any; // 简化应用实例创建

  // ============= HTTP/2服务器SSL增强配置示例 =============
  
  console.log('📊 1. HTTP/2服务器 - 完整SSL/TLS配置演示');

  // 1.1 基础HTTP/2 SSL配置
  const http2BasicConfig: Http2ServerOptions = {
    hostname: '127.0.0.1',
    port: 8080,
    protocol: 'http2',
    ssl: {
      mode: 'auto',
      key: './certs/server.key',
      cert: './certs/server.crt',
      allowHTTP1: true // 允许HTTP/1.1回退
    },
    http2: {
      settings: {
        headerTableSize: 4096,
        enablePush: true,
        maxConcurrentStreams: 100,
        initialWindowSize: 65535
      }
    }
  };

  // 1.2 高性能HTTP/2配置
  const http2PerformanceConfig: Http2ServerOptions = {
    hostname: '127.0.0.1',
    port: 8081,
    protocol: 'http2',
    ssl: {
      mode: 'manual',
      key: './certs/server.key',
      cert: './certs/server.crt',
      ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
      honorCipherOrder: true,
      secureProtocol: 'TLSv1_2_method',
      allowHTTP1: false // 强制HTTP/2
    },
    http2: {
      settings: {
        headerTableSize: 8192,
        enablePush: true,
        maxConcurrentStreams: 200,
        initialWindowSize: 262144,
        maxFrameSize: 32768,
        maxHeaderListSize: 16384
      }
    },
    connectionPool: {
      maxConnections: 1000,
      keepAliveTimeout: 30000,
      headersTimeout: 60000,
      requestTimeout: 120000
    }
  };

  // 1.3 企业级安全HTTP/2配置 (双向TLS)
  const http2SecureConfig: Http2ServerOptions = {
    hostname: '127.0.0.1',
    port: 8082,
    protocol: 'http2',
    ssl: {
      mode: 'mutual_tls',
      key: './certs/server.key',
      cert: './certs/server.crt',
      ca: './certs/ca.crt',
      requestCert: true,
      rejectUnauthorized: true,
      ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:!RC4:!LOW:!MD5:!aNULL',
      allowHTTP1: false
    },
    http2: {
      settings: {
        headerTableSize: 4096,
        enablePush: false, // 禁用服务器推送提高安全性
        maxConcurrentStreams: 50,
        initialWindowSize: 65535
      }
    },
    ext: {
      healthCheck: {
        enabled: true,
        interval: 10000
      },
      metrics: {
        enabled: true,
        interval: 5000
      }
    }
  };

  // ============= 启动HTTP/2服务器演示 =============

  console.log('\n🚀 启动HTTP/2增强服务器...');

  try {
    // 启动基础HTTP/2服务器
    const http2BasicServer = new Http2Server(app, http2BasicConfig);
    http2BasicServer.Start(() => {
      console.log('✅ HTTP/2基础服务器启动成功 - 端口: 8080');
      console.log('   🔐 SSL模式: auto');
      console.log('   🔄 HTTP/1.1回退: 已启用');
      console.log('   📊 并发流: 100');
    });

    // 启动高性能HTTP/2服务器
    const http2PerformanceServer = new Http2Server(app, http2PerformanceConfig);
    http2PerformanceServer.Start(() => {
      console.log('✅ HTTP/2高性能服务器启动成功 - 端口: 8081');
      console.log('   🔐 SSL模式: manual');
      console.log('   ⚡ 强制HTTP/2: 已启用');
      console.log('   📊 并发流: 200');
      console.log('   🔗 最大连接: 1000');
    });

    // 启动企业级安全HTTP/2服务器
    const http2SecureServer = new Http2Server(app, http2SecureConfig);
    http2SecureServer.Start(() => {
      console.log('✅ HTTP/2安全服务器启动成功 - 端口: 8082');
      console.log('   🔐 SSL模式: mutual_tls');
      console.log('   🛡️ 客户端证书: 必需');
      console.log('   🚫 服务器推送: 已禁用');
      console.log('   🏥 健康检查: 已启用');
    });

    // 演示HTTP/2特有的统计监控
    setTimeout(() => {
      console.log('\n📈 HTTP/2会话和流统计监控:');
      
      // 基础服务器统计
      const basicStats = http2BasicServer.getHttp2Stats();
      console.log('  基础服务器 (端口 8080):');
      console.log(`    活跃会话: ${basicStats.activeSessions}`);
      console.log(`    总会话数: ${basicStats.totalSessions}`);
      console.log(`    活跃流: ${basicStats.activeStreams}`);
      console.log(`    总流数: ${basicStats.totalStreams}`);
      console.log(`    会话错误: ${basicStats.sessionErrors}`);
      console.log(`    流错误: ${basicStats.streamErrors}`);

      // 高性能服务器统计
      const perfStats = http2PerformanceServer.getHttp2Stats();
      console.log('  高性能服务器 (端口 8081):');
      console.log(`    活跃会话: ${perfStats.activeSessions}`);
      console.log(`    活跃流: ${perfStats.activeStreams}`);
      console.log(`    连接统计: ${http2PerformanceServer.getConnectionStats().activeConnections} 连接`);

      // 安全服务器统计
      const secureStats = http2SecureServer.getHttp2Stats();
      const secureHealth = http2SecureServer.getHealthStatus();
      console.log('  安全服务器 (端口 8082):');
      console.log(`    健康状态: ${secureHealth?.status || 'unknown'}`);
      console.log(`    SSL检查: ${secureHealth?.checks?.ssl?.status || 'unknown'}`);
      console.log(`    HTTP/2协议: ${secureHealth?.checks?.http2Protocol?.status || 'unknown'}`);
      console.log(`    活跃会话: ${secureStats.activeSessions}`);
    }, 3000);

    // 演示配置热重载
    setTimeout(async () => {
      console.log('\n🔄 演示HTTP/2配置热重载...');
      
      const updated = await http2PerformanceServer.updateConfig({
        http2: {
          settings: {
            maxConcurrentStreams: 300,
            initialWindowSize: 524288
          }
        }
      });

      if (updated) {
        console.log('✅ HTTP/2配置已热重载 (触发优雅重启)');
        console.log('   📊 最大并发流: 200 → 300');
        console.log('   📦 初始窗口大小: 262144 → 524288');
      } else {
        console.log('⚠️ HTTP/2配置无需重启，已实时应用');
      }
    }, 5000);

    // 演示连接池监控
    setTimeout(() => {
      console.log('\n⚡ HTTP/2连接池状态监控:');
      
      // 获取公开的统计信息
      const perfStats = http2PerformanceServer.getHttp2Stats();
      const perfConnectionStats = http2PerformanceServer.getConnectionStats();
      
      console.log('  高性能服务器连接池:');
      console.log(`    配置最大连接: ${http2PerformanceConfig.connectionPool?.maxConnections}`);
      console.log(`    配置Keep-Alive: ${http2PerformanceConfig.connectionPool?.keepAliveTimeout}ms`);
      console.log(`    当前活跃连接: ${perfConnectionStats.activeConnections}`);
      
      console.log('  HTTP/2协议统计:');
      console.log(`    允许HTTP/1.1: ${http2PerformanceConfig.ssl?.allowHTTP1 !== false}`);
      console.log(`    活跃会话: ${perfStats.activeSessions}`);
      console.log(`    活跃流: ${perfStats.activeStreams}`);
      console.log(`    会话错误: ${perfStats.sessionErrors}`);
      console.log(`    流错误: ${perfStats.streamErrors}`);
    }, 7000);

    // 演示优雅关闭
    setTimeout(async () => {
      console.log('\n🛡️ 演示HTTP/2优雅关闭流程...');
      
      console.log('正在优雅关闭基础HTTP/2服务器...');
      await http2BasicServer.gracefulShutdown({
        timeout: 15000,
        drainDelay: 2000
      });
      console.log('✅ 基础HTTP/2服务器已优雅关闭');

      console.log('正在优雅关闭高性能HTTP/2服务器...');
      await http2PerformanceServer.gracefulShutdown({
        timeout: 20000,
        drainDelay: 3000
      });
      console.log('✅ 高性能HTTP/2服务器已优雅关闭');

      console.log('正在优雅关闭安全HTTP/2服务器...');
      await http2SecureServer.gracefulShutdown({
        timeout: 25000,
        drainDelay: 5000
      });
      console.log('✅ 安全HTTP/2服务器已优雅关闭');

      console.log('\n🎉 HTTP/2增强功能演示完成!');
      process.exit(0);
    }, 10000);

  } catch (error) {
    console.error('❌ HTTP/2服务器启动失败:', error);
    process.exit(1);
  }
}

// 显示HTTP/2增强功能说明
function showHTTP2EnhancementFeatures() {
  console.log(`
🚀 HTTP/2增强功能特性:

📊 SSL/TLS增强支持:
  • auto     - 自动SSL配置检测
  • manual   - 手动精确SSL配置  
  • mutual_tls - 双向TLS客户端认证
  • allowHTTP1 - HTTP/1.1协议回退支持

⚡ HTTP/2协议特性:
  • headerTableSize    - HPACK头部压缩表大小
  • enablePush        - 服务器推送功能控制
  • maxConcurrentStreams - 最大并发流数限制
  • initialWindowSize - 流控制初始窗口大小
  • maxFrameSize      - 最大帧大小限制
  • maxHeaderListSize - 最大头部列表大小

🔄 智能会话管理:
  • 实时会话创建和关闭监控
  • 会话错误自动检测和记录
  • 优雅关闭时的会话清理
  • 会话状态统计和报告

📈 流级别监控:
  • 活跃流实时追踪
  • 流生命周期事件记录
  • 流错误统计和分析
  • 流级别性能指标收集

🛡️ 企业级安全:
  • 支持所有TLS版本和密码套件
  • 客户端证书验证
  • 证书链完整性检查
  • 安全协议协商监控

🏥 健康检查增强:
  • HTTP/2协议状态检查
  • SSL证书有效性验证
  • 会话和流健康监控
  • 连接池状态检查

📝 配置示例:

基础HTTP/2配置:
{
  ssl: {
    mode: 'auto',
    key: './certs/server.key',
    cert: './certs/server.crt',
    allowHTTP1: true
  },
  http2: {
    settings: {
      maxConcurrentStreams: 100,
      enablePush: true
    }
  }
}

高性能HTTP/2配置:
{
  ssl: {
    mode: 'manual',
    allowHTTP1: false,
    ciphers: 'ECDHE-RSA-AES256-GCM-SHA384'
  },
  http2: {
    settings: {
      maxConcurrentStreams: 200,
      initialWindowSize: 262144,
      maxFrameSize: 32768
    }
  },
  connectionPool: {
    maxConnections: 1000,
    keepAliveTimeout: 30000
  }
}

企业安全配置:
{
  ssl: {
    mode: 'mutual_tls',
    key: './certs/server.key',
    cert: './certs/server.crt',
    ca: './certs/ca.crt',
    requestCert: true,
    rejectUnauthorized: true
  },
  http2: {
    settings: {
      enablePush: false,
      maxConcurrentStreams: 50
    }
  }
}
`);
}

// 启动示例
if (require.main === module) {
  showHTTP2EnhancementFeatures();
  demonstrateHTTP2Enhancements().catch(console.error);
}

export { demonstrateHTTP2Enhancements }; 