# koatty_serve
Provide http1/2, websocket, gRPC server for Koatty.

## 功能特性

- ✅ **多协议支持**: 同时启动 HTTP、HTTPS、HTTP/2、WebSocket、WSS、gRPC 服务
- ✅ **自动端口分配**: 多协议服务器自动为每个协议分配连续端口
- ✅ **灵活配置**: 支持单协议或多协议配置
- ✅ **优雅关闭**: 统一管理所有服务器的启动和关闭
- ✅ **向后兼容**: 保持原有单协议服务的兼容性

## 基本用法

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

## 端口分配规则

当使用协议数组时，系统会自动分配端口：

- 第一个协议使用指定的基础端口
- 后续协议使用基础端口 + 索引

```typescript
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 8000,
  protocol: ['http', 'ws', 'grpc', 'https']
});

// 端口分配：
// HTTP: 8000
// WebSocket: 8001  
// gRPC: 8002
// HTTPS: 8003
```

## 配置选项

### ListeningOptions

```typescript
interface ListeningOptions {
  hostname: string;                           // 监听地址
  port: number;                              // 基础端口号
  protocol: KoattyProtocol | KoattyProtocol[]; // 单协议或协议数组
  trace?: boolean;                           // 调试跟踪
  ext?: any;                                // 扩展配置
}
```

### 支持的协议类型

```typescript
type KoattyProtocol = 'http' | 'https' | 'http2' | 'grpc' | 'ws' | 'wss';
```

## 高级配置示例

```typescript
const advancedConfig = {
  hostname: '0.0.0.0', // 监听所有网络接口
  port: 3000,
  protocol: ['http', 'ws', 'grpc'],
  trace: true,
  ext: {
    compression: true,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
  }
};

const multiServer = NewServe(app, advancedConfig);
```

## 服务器管理

### 获取特定服务器

```typescript
// 获取特定协议和端口的服务器
const httpServer = multiServer.getServer('http', 3000);
const wsServer = multiServer.getServer('ws', 3001);
```

### 获取所有服务器

```typescript
// 获取所有运行的服务器
const allServers = multiServer.getAllServers();
allServers.forEach((server, key) => {
  console.log(`服务器 ${key} 正在运行`);
});
```

## 优雅关闭

```typescript
// 停止所有服务器
multiServer.Stop(() => {
  console.log('所有服务器已停止');
});

// 处理进程信号
process.on('SIGINT', () => {
  console.log('正在关闭服务器...');
  multiServer.Stop(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
```

## SSL/TLS 配置

对于 HTTPS、HTTP/2、WSS 协议，需要配置 SSL 证书：

```typescript
// 在 Koatty 应用中配置证书文件路径
app.config('key_file', './ssl/server.key');
app.config('crt_file', './ssl/server.crt');

// 使用安全协议
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['https', 'wss']
});
```

## 使用场景

### 1. Web应用 + WebSocket

```typescript
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['http', 'ws']
});
// HTTP API: 3000, WebSocket: 3001
```

### 2. 微服务架构

```typescript
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['http', 'grpc']
});
// HTTP API: 3000, gRPC: 3001
```

### 3. 全协议支持

```typescript
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['http', 'https', 'ws', 'wss', 'grpc']
});
// HTTP: 3000, HTTPS: 3001, WS: 3002, WSS: 3003, gRPC: 3004
```

## 性能考虑

1. **协议选择建议**:
   - HTTP + WebSocket: 适用于实时通信应用
   - HTTPS + WSS: 适用于需要安全传输的实时应用
   - HTTP/2: 适用于高性能Web应用
   - gRPC: 适用于微服务间通信

2. **端口管理**:
   - 确保分配的端口范围可用
   - 考虑防火墙配置
   - 生产环境建议使用固定端口配置

3. **监控和日志**:
   - 启用 `trace: true` 进行调试
   - 每个协议服务器都有独立的日志输出
   - 支持统一的错误处理和监控

## 故障排除

### 常见问题

1. **端口被占用**:
   ```
   Error: listen EADDRINUSE :::3000
   ```
   解决方案：检查端口是否被其他进程占用，或更换基础端口号。

2. **SSL证书问题**:
   ```
   Error: ENOENT: no such file or directory, open './ssl/server.key'
   ```
   解决方案：确保SSL证书文件路径正确，或生成自签名证书用于测试。

3. **gRPC协议文件缺失**:
   ```
   Error: Proto file not found
   ```
   解决方案：确保gRPC的.proto文件路径配置正确。

### 调试技巧

1. 启用详细日志：
   ```typescript
   const config = {
     // ...其他配置
     trace: true
   };
   ```

2. 检查服务器状态：
   ```typescript
   console.log('服务器状态:', multiServer.status);
   console.log('运行的服务器数量:', multiServer.getAllServers().size);
   ```

## 迁移指南

### 从单协议到多协议

如果你现在使用的是单协议服务器：

```typescript
// 旧方式
const server = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: 'http'
});
```

可以轻松迁移到多协议：

```typescript
// 新方式
const multiServer = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['http'] // 使用数组，即使只有一个协议
});
```

### 添加WebSocket支持

```typescript
// 在现有HTTP服务基础上添加WebSocket
const multiServer = NewServe(app, {
  hostname: '127.0.0.1',
  port: 3000,
  protocol: ['http', 'ws'] // HTTP: 3000, WebSocket: 3001
});
```

这样，你的应用就可以同时处理HTTP请求和WebSocket连接了。 