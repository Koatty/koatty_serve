# 优雅关闭指南 (Graceful Shutdown Guide)

## 概述

`koatty_serve` 提供了完整的优雅关闭机制，确保在应用停止时正确清理资源、关闭连接并保存数据。

## 优雅关闭流程

当收到终止信号（如 `SIGTERM`, `SIGINT`, `SIGQUIT`）时，系统会按照以下顺序执行：

```
1. 接收终止信号 (SIGTERM/SIGINT/SIGQUIT)
   ↓
2. 触发 appStop 事件
   ↓
3. 触发 beforeExit 事件
   ↓
4. 调用服务器 gracefulShutdown() 方法
   ↓
5. 关闭所有连接
   ↓
6. 退出进程
```

## 在应用中使用 appStop 事件

### 基本用法

```typescript
import { Application } from 'koatty_core';

export class App extends Application {
  init() {
    // 注册 appStop 事件处理器
    this.on('appStop', async () => {
      console.log('应用正在停止...');
      
      // 执行清理逻辑
      await this.cleanup();
    });
  }

  async cleanup() {
    // 关闭数据库连接
    await this.closeDatabase();
    
    // 清理缓存
    await this.clearCache();
    
    // 保存未完成的任务
    await this.saveUnfinishedTasks();
    
    console.log('清理完成');
  }
}
```

### 数据库连接清理示例

```typescript
export class App extends Application {
  private dbConnection: any;

  init() {
    this.on('appStop', async () => {
      if (this.dbConnection) {
        console.log('关闭数据库连接...');
        await this.dbConnection.close();
        console.log('数据库连接已关闭');
      }
    });
  }
}
```

### 任务队列清理示例

```typescript
export class App extends Application {
  private taskQueue: TaskQueue;

  init() {
    this.on('appStop', async () => {
      console.log('正在完成队列中的任务...');
      
      // 停止接收新任务
      this.taskQueue.stopAcceptingNewTasks();
      
      // 等待现有任务完成
      await this.taskQueue.waitForCompletion(30000); // 30秒超时
      
      console.log('任务队列已清空');
    });
  }
}
```

### 外部服务清理示例

```typescript
export class App extends Application {
  private redisClient: Redis;
  private messageBroker: MessageBroker;

  init() {
    this.on('appStop', async () => {
      console.log('清理外部服务连接...');
      
      // 并行关闭多个服务
      await Promise.all([
        this.redisClient.quit(),
        this.messageBroker.disconnect(),
        this.closeOtherServices()
      ]);
      
      console.log('外部服务连接已关闭');
    });
  }
}
```

## 优雅关闭配置

### 配置超时时间

```typescript
import { CreateTerminus } from 'koatty_serve';

// 自定义终止选项
CreateTerminus(app, server, {
  timeout: 30000, // 30秒超时
  signals: ['SIGTERM', 'SIGINT', 'SIGQUIT'],
  onSignal: customShutdownHandler // 可选的自定义处理器
});
```

### 服务器级别的优雅关闭

服务器会自动执行以下操作：

1. **停止接受新连接**
2. **排空现有连接**（draining）
3. **等待请求完成**
4. **关闭连接池**
5. **清理资源**

```typescript
// 所有服务器类型都支持 gracefulShutdown
const result = await server.gracefulShutdown({
  timeout: 30000,        // 总超时时间
  drainDelay: 5000,      // 排空延迟
  stepTimeout: 10000,    // 单步超时
  forceTimeout: 35000    // 强制关闭超时
});

console.log('优雅关闭结果:', result);
// {
//   status: 'completed',
//   totalTime: 15234,
//   completedSteps: [...],
//   failedSteps: []
// }
```

## 注意事项

### 1. appStop 事件执行顺序

`appStop` 事件会在服务器关闭**之前**触发，确保应用层清理逻辑先于服务器关闭执行。

```typescript
// ✅ 正确：在 appStop 中清理应用资源
this.on('appStop', async () => {
  await this.cleanup();
});

// ❌ 错误：不要在 appStop 中关闭服务器
this.on('appStop', async () => {
  await server.Stop(); // 服务器会自动关闭，无需手动调用
});
```

### 2. 异步操作

所有 `appStop` 事件处理器都会被等待完成：

```typescript
// ✅ 正确：使用 async/await
this.on('appStop', async () => {
  await longRunningCleanup();
});

// ❌ 错误：忘记 await
this.on('appStop', () => {
  longRunningCleanup(); // 可能在完成前被终止
});
```

### 3. 超时处理

如果清理操作超时，进程会被强制终止：

```typescript
this.on('appStop', async () => {
  // 设置自己的超时以避免被强制终止
  const timeout = setTimeout(() => {
    console.warn('清理操作超时，跳过剩余步骤');
  }, 25000);

  try {
    await this.cleanup();
  } finally {
    clearTimeout(timeout);
  }
});
```

### 4. 错误处理

清理操作中的错误不会阻止关闭流程：

```typescript
this.on('appStop', async () => {
  try {
    await riskyCleanup();
  } catch (error) {
    console.error('清理失败，但继续关闭:', error);
    // 不要抛出错误，否则会影响其他清理操作
  }
});
```

## 测试优雅关闭

### 手动测试

```bash
# 启动应用
npm start

# 在另一个终端发送 SIGTERM 信号
kill -TERM <pid>

# 或使用 Ctrl+C (SIGINT)
```

### 单元测试

```typescript
import { onSignal } from 'koatty_serve';

describe('Graceful Shutdown', () => {
  test('appStop 事件应该被触发', async () => {
    let appStopCalled = false;
    
    app.on('appStop', () => {
      appStopCalled = true;
    });
    
    await onSignal('SIGTERM', app, server, 5000);
    
    expect(appStopCalled).toBe(true);
  });
});
```

## 最佳实践

1. **保持清理操作简单快速**：避免在 `appStop` 中执行耗时操作
2. **设置合理的超时时间**：根据实际清理需求配置超时
3. **记录清理日志**：便于调试和监控
4. **幂等性**：确保清理操作可以安全地重复执行
5. **优先级排序**：先清理关键资源，再处理次要资源

## 监控和调试

### 启用调试日志

```typescript
// 设置环境变量
process.env.DEBUG = 'koatty:*';

// 或在代码中启用
app.config({ trace: true });
```

### 查看关闭统计

```typescript
const result = await server.gracefulShutdown();
console.log('关闭统计:', {
  耗时: result.totalTime,
  完成步骤: result.completedSteps,
  失败步骤: result.failedSteps,
  连接统计: server.getConnectionStats()
});
```

## 相关文档

- [BaseServer API 文档](../api/base-server.md)
- [连接池管理](./connection-pool-guide.md)
- [性能优化](./performance-guide.md)

