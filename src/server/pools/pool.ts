/*
 * @Description: 统一连接池管理接口
 * @Usage: 为各协议提供统一的连接池管理接口
 * @Author: richen
 * @Date: 2024-11-27 20:30:00
 * @LastEditTime: 2024-11-27 20:30:00
 */

import { createLogger, generateTraceId } from "../../utils/logger";
import { ConnectionStats } from "../base";

/**
 * 统一连接池配置接口
 */
export interface ConnectionPoolConfig {
  maxConnections?: number;          // 最大连接数
  connectionTimeout?: number;       // 连接超时时间 (毫秒)
  keepAliveTimeout?: number;        // Keep-Alive超时时间 (毫秒)
  requestTimeout?: number;          // 请求超时时间 (毫秒)
  headersTimeout?: number;          // 请求头超时时间 (毫秒)
  
  // 协议特定配置
  protocolSpecific?: {
    // HTTP/2 特定
    maxSessionMemory?: number;
    maxHeaderListSize?: number;
    
    // gRPC 特定
    maxReceiveMessageLength?: number;
    maxSendMessageLength?: number;
    keepAliveTime?: number;
    
    // WebSocket 特定
    pingInterval?: number;
    pongTimeout?: number;
  };
}

/**
 * 连接池状态枚举
 */
export enum ConnectionPoolStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  OVERLOADED = 'overloaded',
  UNAVAILABLE = 'unavailable'
}

/**
 * 连接池健康状态
 */
export interface ConnectionPoolHealth {
  status: ConnectionPoolStatus;
  utilizationRatio: number;         // 利用率 (0-1)
  activeConnections: number;        // 活跃连接数
  maxConnections: number;           // 最大连接数
  rejectedConnections: number;      // 被拒绝的连接数
  averageResponseTime: number;      // 平均响应时间
  errorRate: number;                // 错误率
  message: string;                  // 状态描述
}

/**
 * 连接池指标
 */
export interface ConnectionPoolMetrics extends ConnectionStats {
  protocol: string;
  poolConfig: ConnectionPoolConfig;
  health: ConnectionPoolHealth;
  performance: {
    throughput: number;             // 吞吐量 (requests/second)
    latency: {
      p50: number;
      p95: number;
      p99: number;
    };
    memoryUsage: number;            // 内存使用量 (bytes)
    cpuUsage: number;               // CPU使用率 (percent)
  };
  uptime: number;                   // 运行时间 (毫秒)
}

/**
 * 连接池事件类型
 */
export enum ConnectionPoolEvent {
  CONNECTION_ADDED = 'connection_added',
  CONNECTION_REMOVED = 'connection_removed',
  CONNECTION_TIMEOUT = 'connection_timeout',
  CONNECTION_ERROR = 'connection_error',
  POOL_LIMIT_REACHED = 'pool_limit_reached',
  HEALTH_STATUS_CHANGED = 'health_status_changed'
}

/**
 * 抽象连接池管理器
 */
export abstract class ConnectionPoolManager<T = any> {
  protected readonly logger = createLogger({ module: 'connection_pool' });
  protected readonly config: ConnectionPoolConfig;
  protected readonly protocol: string;
  protected readonly startTime = Date.now();
  protected currentHealth: ConnectionPoolHealth;
  protected metrics: ConnectionPoolMetrics;
  protected eventListeners = new Map<ConnectionPoolEvent, Set<Function>>();

  constructor(protocol: string, config: ConnectionPoolConfig = {}) {
    this.protocol = protocol;
    this.config = this.validateAndNormalizeConfig(config);
    
    this.logger = createLogger({ 
      module: 'connection_pool', 
      protocol: this.protocol 
    });

    // 初始化健康状态
    this.currentHealth = {
      status: ConnectionPoolStatus.HEALTHY,
      utilizationRatio: 0,
      activeConnections: 0,
      maxConnections: this.config.maxConnections || Infinity,
      rejectedConnections: 0,
      averageResponseTime: 0,
      errorRate: 0,
      message: 'Connection pool initialized'
    };

    // 初始化指标
    this.metrics = {
      activeConnections: 0,
      totalConnections: 0,
      connectionsPerSecond: 0,
      averageLatency: 0,
      errorRate: 0,
      protocol: this.protocol,
      poolConfig: this.config,
      health: this.currentHealth,
      performance: {
        throughput: 0,
        latency: { p50: 0, p95: 0, p99: 0 },
        memoryUsage: 0,
        cpuUsage: 0
      },
      uptime: 0
    };

    this.logger.info('Connection pool manager initialized', {}, {
      protocol: this.protocol,
      config: this.config
    });
  }

  /**
   * 验证和规范化配置
   */
  protected validateAndNormalizeConfig(config: ConnectionPoolConfig): ConnectionPoolConfig {
    const normalized: ConnectionPoolConfig = {
      maxConnections: config.maxConnections || 1000,
      connectionTimeout: config.connectionTimeout || 30000,
      keepAliveTimeout: config.keepAliveTimeout || 5000,
      requestTimeout: config.requestTimeout || 30000,
      headersTimeout: config.headersTimeout || 10000,
      ...config
    };

    // 验证配置合理性
    if (normalized.maxConnections && normalized.maxConnections <= 0) {
      throw new Error('maxConnections must be positive');
    }
    if (normalized.connectionTimeout && normalized.connectionTimeout <= 0) {
      throw new Error('connectionTimeout must be positive');
    }

    return normalized;
  }

  // ============= 抽象方法 - 各协议必须实现 =============

  /**
   * 添加连接到池中
   */
  abstract addConnection(connection: T, metadata?: any): Promise<boolean>;

  /**
   * 从池中移除连接
   */
  abstract removeConnection(connection: T, reason?: string): Promise<void>;

  /**
   * 获取活跃连接数
   */
  abstract getActiveConnectionCount(): number;

  /**
   * 检查连接是否健康
   */
  abstract isConnectionHealthy(connection: T): boolean;

  /**
   * 关闭所有连接
   */
  abstract closeAllConnections(timeout?: number): Promise<void>;

  /**
   * 协议特定的连接验证
   */
  protected abstract validateConnection(connection: T): boolean;

  /**
   * 协议特定的连接清理
   */
  protected abstract cleanupConnection(connection: T): Promise<void>;

  // ============= 公共方法 =============

  /**
   * 检查是否可以接受新连接
   */
  canAcceptConnection(): boolean {
    const maxConnections = this.config.maxConnections;
    if (!maxConnections) return true;
    
    const currentConnections = this.getActiveConnectionCount();
    return currentConnections < maxConnections;
  }

  /**
   * 更新连接池健康状态
   */
  updateHealthStatus(): void {
    const activeConnections = this.getActiveConnectionCount();
    const maxConnections = this.config.maxConnections || Infinity;
    const utilizationRatio = maxConnections === Infinity ? 0 : activeConnections / maxConnections;
    
    let status = ConnectionPoolStatus.HEALTHY;
    let message = 'Connection pool is healthy';

    if (utilizationRatio > 0.95) {
      status = ConnectionPoolStatus.OVERLOADED;
      message = 'Connection pool is overloaded';
    } else if (utilizationRatio > 0.8) {
      status = ConnectionPoolStatus.DEGRADED;
      message = 'Connection pool is under high load';
    }

    const oldStatus = this.currentHealth.status;
    this.currentHealth = {
      ...this.currentHealth,
      status,
      utilizationRatio,
      activeConnections,
      maxConnections: maxConnections === Infinity ? 0 : maxConnections,
      message
    };

    // 如果状态改变，触发事件
    if (oldStatus !== status) {
      this.emitEvent(ConnectionPoolEvent.HEALTH_STATUS_CHANGED, {
        oldStatus,
        newStatus: status,
        health: this.currentHealth
      });
    }
  }

  /**
   * 获取连接池健康状态
   */
  getHealth(): ConnectionPoolHealth {
    this.updateHealthStatus();
    return { ...this.currentHealth };
  }

  /**
   * 获取连接池指标
   */
  getMetrics(): ConnectionPoolMetrics {
    const uptime = Date.now() - this.startTime;
    
    return {
      ...this.metrics,
      uptime,
      health: this.getHealth(),
      activeConnections: this.getActiveConnectionCount()
    };
  }

  /**
   * 获取连接池配置
   */
  getConfig(): Readonly<ConnectionPoolConfig> {
    return { ...this.config };
  }

  /**
   * 更新连接池配置
   */
  async updateConfig(newConfig: Partial<ConnectionPoolConfig>): Promise<boolean> {
    const traceId = generateTraceId();
    
    try {
      this.logger.info('Updating connection pool configuration', { traceId }, {
        oldConfig: this.config,
        newConfig
      });

      const updatedConfig = this.validateAndNormalizeConfig({
        ...this.config,
        ...newConfig
      });

      // 应用新配置
      Object.assign(this.config, updatedConfig);
      
      // 更新指标中的配置
      this.metrics.poolConfig = this.config;

      this.logger.info('Connection pool configuration updated successfully', { traceId });
      return true;
    } catch (error) {
      this.logger.error('Failed to update connection pool configuration', { traceId }, error);
      return false;
    }
  }

  /**
   * 添加事件监听器
   */
  on(event: ConnectionPoolEvent, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * 移除事件监听器
   */
  off(event: ConnectionPoolEvent, listener: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * 触发事件
   */
  protected emitEvent(event: ConnectionPoolEvent, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          this.logger.error('Error in connection pool event listener', {}, error);
        }
      });
    }
  }

  /**
   * 记录连接事件用于统计
   */
  protected recordConnectionEvent(event: 'added' | 'removed' | 'error', _metadata?: any): void {
    const timestamp = Date.now();
    
    switch (event) {
      case 'added':
        this.metrics.totalConnections++;
        break;
      case 'error':
        this.metrics.errorRate = Math.min(this.metrics.errorRate + 0.01, 1);
        break;
    }

    // 计算每秒连接数
    const timeDiff = (timestamp - this.startTime) / 1000;
    if (timeDiff > 0) {
      this.metrics.connectionsPerSecond = this.metrics.totalConnections / timeDiff;
    }
  }

  /**
   * 销毁连接池管理器
   */
  async destroy(): Promise<void> {
    const traceId = generateTraceId();
    
    this.logger.info('Destroying connection pool manager', { traceId });
    
    try {
      await this.closeAllConnections(5000);
      this.eventListeners.clear();
      
      this.logger.info('Connection pool manager destroyed successfully', { traceId });
    } catch (error) {
      this.logger.error('Error destroying connection pool manager', { traceId }, error);
      throw error;
    }
  }
}

/**
 * 连接池管理器工厂
 */
export class ConnectionPoolFactory {
  private static instances = new Map<string, ConnectionPoolManager>();

  /**
   * 创建或获取连接池管理器实例
   */
  static getOrCreate<T extends ConnectionPoolManager>(
    protocol: string,
    config: ConnectionPoolConfig,
    factory: () => T
  ): T {
    const key = `${protocol}_${JSON.stringify(config)}`;
    
    if (!this.instances.has(key)) {
      const instance = factory();
      this.instances.set(key, instance);
    }
    
    return this.instances.get(key) as T;
  }

  /**
   * 销毁指定协议的连接池管理器
   */
  static async destroy(protocol: string): Promise<void> {
    const toDestroy = Array.from(this.instances.entries())
      .filter(([key]) => key.startsWith(protocol))
      .map(([key, instance]) => ({ key, instance }));

    await Promise.all(
      toDestroy.map(async ({ key, instance }) => {
        await instance.destroy();
        this.instances.delete(key);
      })
    );
  }

  /**
   * 获取所有连接池实例的统计
   */
  static getAllMetrics(): Record<string, ConnectionPoolMetrics> {
    const metrics: Record<string, ConnectionPoolMetrics> = {};
    
    this.instances.forEach((instance, key) => {
      metrics[key] = instance.getMetrics();
    });
    
    return metrics;
  }
} 