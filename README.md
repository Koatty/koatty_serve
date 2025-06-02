# koatty_serve

Koatty的高性能多协议服务器，提供统一的HTTP、HTTPS、HTTP/2、WebSocket、gRPC服务支持，具备企业级的配置热重载、优雅关闭、健康检查和性能监控功能。

## 🚀 核心特性

### 多协议统一架构
- ✅ **多协议支持**: HTTP、HTTPS、HTTP/2、WebSocket、WSS、gRPC
- ✅ **统一管理**: 一套代码同时管理多种协议服务器
- ✅ **自动端口分配**: 智能分配连续端口给不同协议
- ✅ **向后兼容**: 完全兼容现有单协议服务

### 企业级运维功能
- 🔄 **配置热重载**: 无需重启即可更新非关键配置
- 🛡️ **优雅关闭**: 五步式优雅关闭，保证数据完整性
- 🏥 **健康检查**: 多层次健康状态监控和自动检查
- 📊 **性能监控**: 实时指标收集和历史数据分析
- 📝 **结构化日志**: 统一的日志记录和追踪系统

### 高级安全特性
- 🔐 **SSL/TLS增强**: 支持单向、双向TLS和证书管理
- 🔒 **gRPC安全**: 完整的gRPC安全连接支持
- 🛠️ **连接管理**: 高效的连接池和资源管理

## 📦 安装

```bash
npm install koatty_serve
# 或者
pnpm add koatty_serve
```

## 🎯 快速开始

### 1. 单协议服务（向后兼容）

```typescript
import { NewServe } from "koatty_serve";

// 创建单个HTTP服务器
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: 'http'
});

server.Start(() => {
  console.log('HTTP服务器已启动: http://127.0.0.1:3000');
});
```

### 2. 多协议服务器

```typescript
import { NewServe } from "koatty_serve";

// 使用协议数组创建多协议服务器
const multiServer = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000, // 基础端口，其他协议将使用 3001, 3002 等
  protocol: ['http', 'ws', 'grpc'] // 协议数组
});

multiServer.Start(() => {
  console.log('多协议服务器已启动');
  // HTTP: 3000, WebSocket: 3001, gRPC: 3002
});
```

### 3. 企业级配置

```typescript
const enterpriseConfig = {
  hostname: '0.0.0.0',
  port: 3000,
  protocol: ['http', 'https', 'ws'],
  ext: {
    // SSL配置 (HTTPS/WSS)
    key: './ssl/server.key',
    cert: './ssl/server.crt',
    
    // 健康检查配置
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
    
    // 性能指标配置
    metrics: {
      enabled: true,
      interval: 10000,   // 10秒收集间隔
      retention: 300000  // 5分钟数据保留
    },
    
    // 连接管理
    maxConnections: 1000,
    connectionTimeout: 30000
  }
};

const server = NewServe(app, enterpriseConfig);
```

## 🏗️ 统一协议架构

### BaseServer 抽象类

所有协议服务器都继承自统一的 `BaseServer` 抽象类，提供：

- **配置热重载**: 智能检测配置变更，决定是否需要重启
- **优雅关闭**: 五步式关闭流程，确保安全停机
- **健康检查**: 统一的健康状态接口和协议特定检查
- **性能监控**: 统一的指标收集和历史数据管理
- **结构化日志**: 带追踪ID的结构化日志系统

### 协议特定实现

每个协议服务器实现协议特定的功能：

```typescript
// HTTP服务器 - 基础Web服务
class HttpServer extends BaseServer {
  // 实现HTTP特定的健康检查
  // 实现HTTP连接管理
  // 实现SSL升级检测
}

// gRPC服务器 - 高性能RPC
class GrpcServer extends BaseServer {
  // 实现gRPC连接池管理
  // 实现SSL/TLS安全配置
  // 实现服务方法监控
}

// WebSocket服务器 - 实时通信
class WsServer extends BaseServer {
  // 实现WebSocket连接限制
  // 实现连接超时管理
  // 实现自动清理机制
}
```

## 🔄 配置热重载

### 自动配置检测

```typescript
// 更新配置
const result = await server.updateConfig({
  ext: {
    maxConnections: 2000,      // 运行时更新
    connectionTimeout: 60000   // 运行时更新
  }
});

// 如果是关键配置更改，将自动执行优雅重启
const criticalUpdate = await server.updateConfig({
  hostname: '0.0.0.0',  // 关键配置，需要重启
  port: 8080            // 关键配置，需要重启
});
```

### 配置变更类型

- **关键配置**: 网络配置、SSL证书 → 自动优雅重启
- **运行时配置**: 连接限制、超时设置 → 实时应用
- **监控配置**: 健康检查、指标收集 → 动态调整

## 🛡️ 优雅关闭

### 五步式关闭流程

```typescript
// 手动触发优雅关闭
await server.gracefulShutdown({
  timeout: 30000,      // 总超时时间
  drainDelay: 5000,    // 停止接受新连接后等待时间
  stepTimeout: 6000    // 每步骤超时时间
});
```

**关闭步骤**:
1. **停止接受新连接** - 关闭服务器监听
2. **等待排空延迟** - 让负载均衡器发现状态变化
3. **等待现有连接完成** - 等待活跃请求处理完毕
4. **强制关闭剩余连接** - 终止超时连接
5. **清理监控和资源** - 停止监控服务，清理资源

## 🏥 健康检查系统

### 健康检查端点

```typescript
import { 
  globalHealthHandler, 
  createHealthMiddleware 
} from 'koatty_serve/utils/health-endpoints';

// 注册服务器到健康监控
globalHealthHandler.registerServer('http_3000', httpServer);
globalHealthHandler.registerServer('grpc_3001', grpcServer);

// 创建健康检查HTTP服务
const healthServer = createServer(createHealthMiddleware(globalHealthHandler));
healthServer.listen(8080);
```

### 可用端点

```bash
# 健康检查
GET /health                          # 所有服务器的健康状态
GET /health?server=http_3000        # 特定服务器状态
GET /health?detailed=true           # 详细健康信息

# 性能指标
GET /metrics                         # JSON格式指标
GET /metrics?format=prometheus      # Prometheus格式
GET /metrics?history=true           # 包含历史数据

# 服务器管理
GET /servers                         # 服务器列表
```

### 健康状态类型

- **🟢 healthy**: 所有检查正常
- **🟡 degraded**: 性能下降但可用
- **🔴 unhealthy**: 服务不可用

## 📊 性能监控系统

### 指标类型

```typescript
interface PerformanceMetrics {
  // 服务器指标
  uptime: number;                    // 运行时间
  memoryUsage: NodeJS.MemoryUsage;   // 内存使用
  cpuUsage: NodeJS.CpuUsage;         // CPU使用
  
  // 连接指标
  connections: {
    activeConnections: number;        // 活跃连接
    totalConnections: number;         // 历史总连接
    connectionsPerSecond: number;     // 连接速率
    averageLatency: number;           // 平均延迟
    errorRate: number;                // 错误率
  };
  
  // 请求指标
  requests: {
    total: number;                    // 总请求数
    successful: number;               // 成功请求
    failed: number;                   // 失败请求
    rate: number;                     // 请求速率
    averageResponseTime: number;      // 平均响应时间
  };
  
  // 协议特定指标
  custom: Record<string, any>;
}
```

### Prometheus 集成

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'koatty-servers'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
    params:
      format: ['prometheus']
    scrape_interval: 15s
```

## 🔐 SSL/TLS 安全配置

### gRPC安全模式

```typescript
const grpcConfig = {
  hostname: '127.0.0.1',
  port: 50051,
  protocol: 'grpc',
  ext: {
    // SSL配置
    ssl: {
      mode: 'mutual_tls',           // mutual_tls | one_way_tls | insecure
      key: './certs/server.key',
      cert: './certs/server.crt',
      ca: './certs/ca.crt',
      checkServerIdentity: true
    },
    
    // 连接池配置
    connectionPool: {
      maxConnections: 100,
      keepAliveTime: 30000,
      keepAliveTimeout: 5000,
      maxReceiveMessageLength: 1024 * 1024 * 4,
      maxSendMessageLength: 1024 * 1024 * 4
    }
  }
};
```

### HTTPS/WSS配置

```typescript
const httpsConfig = {
  hostname: '127.0.0.1',
  port: 443,
  protocol: ['https', 'wss'],
  ext: {
    key: './ssl/server.key',
    cert: './ssl/server.crt',
    
    // 高级SSL选项
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:!RC4:!LOW:!MD5:!aNULL:!EDH',
    honorCipherOrder: true,
    secureProtocol: 'TLSv1_2_method'
  }
};
```

## 🚦 端口分配规则

### 自动端口分配

```typescript
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 8000,
  protocol: ['http', 'ws', 'grpc', 'https']
});

// 自动端口分配：
// HTTP: 8000 (基础端口)
// WebSocket: 8001 (基础端口 + 1)
// gRPC: 8002 (基础端口 + 2)  
// HTTPS: 8003 (基础端口 + 3)
```

### 手动端口指定

```typescript
// 为每个协议指定具体端口
const servers = [
  NewServe(app, { port: 3000, protocol: 'http' }),
  NewServe(app, { port: 3001, protocol: 'ws' }),
  NewServe(app, { port: 50051, protocol: 'grpc' })
];
```

## 📈 生产环境部署

### Kubernetes 集成

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: koatty-config
data:
  config.json: |
    {
      "hostname": "0.0.0.0",
      "port": 3000,
      "protocol": ["http", "grpc"],
      "ext": {
        "healthCheck": {
          "enabled": true,
          "interval": 30000
        },
        "metrics": {
          "enabled": true,
          "interval": 15000
        }
      }
    }

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: koatty-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: koatty-server
  template:
    metadata:
      labels:
        app: koatty-server
    spec:
      containers:
      - name: koatty-server
        image: your-app:latest
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 3001  
          name: grpc
        - containerPort: 8080
          name: health
        # 健康检查
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health?detailed=true
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Docker 配置

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# 暴露端口
EXPOSE 3000 3001 8080

# 优雅关闭支持
STOPSIGNAL SIGTERM

CMD ["node", "dist/app.js"]
```

### Nginx 负载均衡

```nginx
upstream koatty_http {
    server 127.0.0.1:3000;
    server 127.0.0.1:3010;
    server 127.0.0.1:3020;
    
    # 健康检查
    health_check uri=/health match=server_ok;
}

upstream koatty_grpc {
    server 127.0.0.1:3001;
    server 127.0.0.1:3011; 
    server 127.0.0.1:3021;
}

match server_ok {
    status 200;
    header Content-Type ~ "application/json";
    body ~ '"status":"healthy"';
}

server {
    listen 80;
    
    location / {
        proxy_pass http://koatty_http;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 50051 http2;
    
    location / {
        grpc_pass grpc://koatty_grpc;
    }
}
```

## 🔧 服务器管理

### 获取服务器实例

```typescript
// 获取特定协议的服务器
const httpServer = multiServer.getServer('http', 3000);
const grpcServer = multiServer.getServer('grpc', 3001);

// 获取所有服务器
const allServers = multiServer.getAllServers();
allServers.forEach((server, key) => {
  console.log(`服务器 ${key}:`, {
    protocol: server.protocol,
    status: server.getStatus(),
    connections: server.getActiveConnections?.() || 0
  });
});
```

### 运行时管理

```typescript
// 记录请求指标
httpServer.recordRequest(true, 150);  // 成功请求，150ms响应时间
httpServer.recordRequest(false, 500); // 失败请求，500ms响应时间

// 获取实时状态
const health = httpServer.getHealthStatus();
const metrics = httpServer.getPerformanceMetrics();
const stats = httpServer.getConnectionStats();

console.log('健康状态:', health?.status);
console.log('活跃连接:', stats?.activeConnections);
console.log('内存使用:', `${(metrics?.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
```

## 🎯 使用场景

### 1. 微服务架构

```typescript
// API Gateway + gRPC 后端
const gateway = NewServe(app, {
  hostname: '0.0.0.0',
  port: 3000,
  protocol: ['http', 'grpc'],
  ext: {
    healthCheck: { enabled: true },
    metrics: { enabled: true }
  }
});
```

### 2. 实时通信应用

```typescript
// Web应用 + WebSocket + REST API
const realtimeApp = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['http', 'ws'],
  ext: {
    maxConnections: 10000,
    connectionTimeout: 60000
  }
});
```

### 3. 高可用服务

```typescript
// 全协议支持 + 完整监控
const haService = NewServe(app, {
  hostname: '0.0.0.0',
  port: 3000,
  protocol: ['http', 'https', 'ws', 'wss', 'grpc'],
  ext: {
    // SSL配置
    key: './ssl/server.key',
    cert: './ssl/server.crt',
    
    // 健康检查
    healthCheck: {
      enabled: true,
      interval: 15000,
      checks: {
        connections: true,
        memory: true,
        dependencies: true
      }
    },
    
    // 性能监控
    metrics: {
      enabled: true,
      interval: 5000,
      retention: 600000
    }
  }
});
```

## 🔍 监控和告警

### 自定义健康检查

```typescript
class CustomServer extends BaseServer {
  protected async performProtocolHealthChecks() {
    const checks = await super.performProtocolHealthChecks();
    
    // 数据库连接检查
    checks.database = await this.checkDatabase();
    
    // Redis 连接检查  
    checks.redis = await this.checkRedis();
    
    // 外部API检查
    checks.external_api = await this.checkExternalAPI();
    
    return checks;
  }
  
  private async checkDatabase() {
    try {
      await this.db.ping();
      return {
        status: HealthStatus.HEALTHY,
        message: 'Database connection healthy',
        details: { responseTime: 25 }
      };
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Database connection failed',
        details: { error: error.message }
      };
    }
  }
}
```

### 告警集成

```typescript
// 健康状态变化监听
server.on('healthStatusChanged', (oldStatus, newStatus) => {
  if (newStatus === HealthStatus.UNHEALTHY) {
    // 发送紧急告警
    alerting.sendCriticalAlert({
      service: 'koatty-server',
      message: 'Server is unhealthy',
      timestamp: Date.now()
    });
  }
});

// 性能阈值告警
server.on('metricsCollected', (metrics) => {
  if (metrics.requests.averageResponseTime > 1000) {
    alerting.sendWarning({
      service: 'koatty-server',
      message: `High response time: ${metrics.requests.averageResponseTime}ms`,
      timestamp: Date.now()
    });
  }
});
```

## 🛠️ 故障排除

### 常见问题

1. **端口被占用**:
   ```
   Error: listen EADDRINUSE :::3000
   ```
   **解决方案**: 检查端口占用 `lsof -i :3000`，或更换端口

2. **SSL证书问题**:
   ```
   Error: ENOENT: no such file or directory, open './ssl/server.key'
   ```
   **解决方案**: 检查证书文件路径，生成自签名证书进行测试

3. **健康检查失败**:
   ```
   Health check timeout
   ```
   **解决方案**: 增加超时时间，检查依赖服务状态

4. **连接数过多**:
   ```
   Max connections exceeded
   ```
   **解决方案**: 调整 `maxConnections` 配置，优化连接管理

### 调试技巧

```typescript
// 启用详细日志
const debugConfig = {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: 'http',
  trace: true,  // 启用调试跟踪
  ext: {
    healthCheck: {
      enabled: true,
      interval: 5000  // 更频繁的健康检查
    }
  }
};

// 监听服务器事件
server.on('connection', (socket) => {
  console.log('新连接建立:', socket.remoteAddress);
});

server.on('error', (error) => {
  console.error('服务器错误:', error);
});
```

## 📚 API 参考

### 核心接口

```typescript
// 主要配置接口
interface ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol | KoattyProtocol[];
  trace?: boolean;
  ext?: {
    // SSL配置
    key?: string;
    cert?: string;
    ca?: string;
    
    // 健康检查配置
    healthCheck?: HealthCheckConfig;
    
    // 指标配置
    metrics?: MetricsConfig;
    
    // 连接管理
    maxConnections?: number;
    connectionTimeout?: number;
    
    // 其他扩展配置
    [key: string]: any;
  };
}

// 支持的协议类型
type KoattyProtocol = 'http' | 'https' | 'http2' | 'grpc' | 'ws' | 'wss';
```

### 主要方法

```typescript
// 创建服务器
function NewServe(app: KoattyApplication, options: ListeningOptions): KoattyServer;

// 服务器方法
interface KoattyServer {
  Start(listenCallback?: () => void): any;
  Stop(callback?: (err?: Error) => void): void;
  getStatus(): number;
  updateConfig(newConfig: Partial<ListeningOptions>): Promise<boolean>;
  gracefulShutdown(options?: GracefulShutdownOptions): Promise<void>;
  getHealthStatus(): HealthCheckResult | null;
  getPerformanceMetrics(): PerformanceMetrics | null;
}
```

## 🚀 性能优化建议

### 生产环境配置

```typescript
const productionConfig = {
  hostname: '0.0.0.0',
  port: 3000,
  protocol: ['http', 'grpc'],
  ext: {
    // 优化连接管理
    maxConnections: 5000,
    connectionTimeout: 30000,
    
    // 降低监控频率以减少开销
    healthCheck: {
      enabled: true,
      interval: 60000,    // 1分钟检查一次
      timeout: 3000       // 3秒超时
    },
    
    // 优化指标收集
    metrics: {
      enabled: true,
      interval: 30000,    // 30秒收集一次
      retention: 300000   // 保留5分钟数据
    }
  }
};
```

### 性能基准

- **HTTP**: 支持 50,000+ 并发连接
- **WebSocket**: 支持 10,000+ 实时连接
- **gRPC**: 支持 100+ MB/s 吞吐量
- **监控开销**: < 1% CPU，< 10MB 内存

## 📄 许可证

[BSD-3-Clause](LICENSE)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

- 📧 邮件: richen@126.com
- 🌐 官网: [koatty.com](https://koatty.com)
- 📖 文档: [docs.koatty.com](https://docs.koatty.com) 