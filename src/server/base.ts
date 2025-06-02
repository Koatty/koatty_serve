/* 
 * @Description: Base server class with config hot reload and graceful shutdown support
 * @Usage: 
 * @Author: richen
 * @Date: 2025-04-08 10:45:00
 * @License: BSD (3-Clause)
 */

import { KoattyApplication, KoattyServer, NativeServer } from "koatty_core";
import { createLogger, generateTraceId } from "../utils/logger";
import { deepEqual } from "../utils/helper";

// KoattyProtocol
export type KoattyProtocol = 'http' | "https" | 'http2' | 'grpc' | 'ws' | 'wss';

/**
 * listening options
 *
 * @interface ListeningOptions
 */
export interface ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol;
  ext?: Record<string, any>; // Other extended configuration
}

/**
 * Configuration change detection result
 */
export interface ConfigChangeAnalysis {
  requiresRestart: boolean;
  changedKeys: (keyof ListeningOptions)[];
  restartReason?: string;
  canApplyRuntime?: boolean;
}

/**
 * Graceful shutdown options
 */
export interface GracefulShutdownOptions {
  timeout?: number;        // 总超时时间（毫秒）
  drainDelay?: number;     // 停止接受新连接后的等待时间
  stepTimeout?: number;    // 每个步骤的超时时间
}

/**
 * Connection statistics interface
 */
export interface ConnectionStats {
  activeConnections: number;
  totalConnections: number;
  connectionsPerSecond: number;
  averageLatency: number;
  errorRate: number;
}

/**
 * Health check status
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded'
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  checks: {
    [key: string]: {
      status: HealthStatus;
      message?: string;
      duration?: number;
      details?: any;
    };
  };
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  // Server metrics
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  
  // Connection metrics
  connections: ConnectionStats;
  
  // Request metrics
  requests: {
    total: number;
    successful: number;
    failed: number;
    rate: number; // requests per second
    averageResponseTime: number;
  };
  
  // Performance counters
  performance: {
    gcCount: number;
    gcDuration: number;
    eventLoopLag: number;
    eventLoopUtilization: number;
  };
  
  // Custom metrics per protocol
  custom: Record<string, any>;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  enabled: boolean;
  endpoint?: string;
  interval?: number; // Health check interval in ms
  timeout?: number;  // Health check timeout in ms
  checks?: {
    [key: string]: boolean; // Enable/disable specific checks
  };
}

/**
 * Metrics collection configuration
 */
export interface MetricsConfig {
  enabled: boolean;
  endpoint?: string;
  interval?: number; // Metrics collection interval in ms
  retention?: number; // How long to keep metrics in memory (ms)
}

/**
 * Base server class with config hot reload and graceful shutdown support
 */
export abstract class BaseServer<T extends ListeningOptions = ListeningOptions> implements KoattyServer {
  options: T;
  readonly server: any; // Use any to allow different server implementations (http/https/ws/grpc/http2)
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;
  protected configVersion = 0;
  protected logger = createLogger({ module: 'base' });
  
  // Graceful shutdown state
  protected isShuttingDown = false;
  protected shutdownTimeout = 30000; // 30秒默认超时
  protected drainDelay = 5000;       // 5秒排空延迟

  // Health check and metrics
  protected healthCheckConfig: HealthCheckConfig = {
    enabled: true,
    endpoint: '/health',
    interval: 30000, // 30 seconds
    timeout: 5000,   // 5 seconds
    checks: {
      connections: true,
      memory: true,
      disk: true,
      dependencies: true
    }
  };
  
  protected metricsConfig: MetricsConfig = {
    enabled: true,
    endpoint: '/metrics',
    interval: 10000,  // 10 seconds
    retention: 300000 // 5 minutes
  };

  private startTime = Date.now();
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private lastHealthCheck: HealthCheckResult | null = null;
  private performanceMetrics: PerformanceMetrics | null = null;
  private metricsHistory: PerformanceMetrics[] = [];
  private requestMetrics = {
    total: 0,
    successful: 0,
    failed: 0,
    responseTimes: [] as number[]
  };

  constructor(protected app: KoattyApplication, options: T) {
    this.options = { ...options };
    this.protocol = options.protocol;
    this.status = 0;
    
    // Set logger context
    this.logger = createLogger({ 
      module: 'base', 
      protocol: options.protocol 
    });

    // Initialize health checks and metrics if enabled
    if (options.ext?.healthCheck) {
      this.healthCheckConfig = { ...this.healthCheckConfig, ...options.ext.healthCheck };
    }
    if (options.ext?.metrics) {
      this.metricsConfig = { ...this.metricsConfig, ...options.ext.metrics };
    }

    this.logger.debug('Base server constructed', {}, {
      protocol: options.protocol,
      hostname: options.hostname,
      port: options.port,
      healthCheckEnabled: this.healthCheckConfig.enabled,
      metricsEnabled: this.metricsConfig.enabled
    });
  }

  /**
   * Update configuration (hot reload)
   */
  async updateConfig(newConfig: Partial<T>): Promise<boolean> {
    const traceId = generateTraceId();
    const oldConfig = { ...this.options };
    const mergedConfig = { ...this.options, ...newConfig };
    
    // Detect changed keys
    const changedKeys = Object.keys(newConfig).filter(key => 
      !deepEqual(oldConfig[key as keyof T], newConfig[key as keyof T])
    ) as (keyof ListeningOptions)[];

    if (changedKeys.length === 0) {
      this.logger.debug('No configuration changes detected', { traceId });
      return false;
    }

    this.logger.info('Configuration update initiated', { traceId }, {
      changedKeys: changedKeys.map(String),
      oldConfig: this.extractRelevantConfig(oldConfig),
      newConfig: this.extractRelevantConfig(mergedConfig)
    });

    // Analyze configuration changes
    const analysis = this.analyzeConfigChanges(changedKeys, oldConfig, mergedConfig);
    
    this.logger.info('Configuration change analysis completed', { traceId }, {
      requiresRestart: analysis.requiresRestart,
      restartReason: analysis.restartReason,
      canApplyRuntime: analysis.canApplyRuntime
    });

    try {
      if (analysis.requiresRestart) {
        // Critical changes require restart
        this.logger.info('Performing graceful restart due to critical configuration changes', { traceId }, {
          reason: analysis.restartReason
        });
        
        // Execute graceful shutdown
        await this.gracefulShutdown({
          timeout: this.shutdownTimeout,
          drainDelay: this.drainDelay
        });
        
        // Apply new configuration
        this.options = mergedConfig;
        this.configVersion++;
        
        // Start server with new configuration
        this.Start();
        
        this.logger.info('Graceful restart completed successfully', { traceId }, {
          configVersion: this.configVersion
        });
        
      } else if (analysis.canApplyRuntime) {
        // Runtime changes can be applied without restart
        this.options = mergedConfig;
        this.configVersion++;
        
        this.onRuntimeConfigChange(analysis, newConfig, traceId);
        
        this.logger.info('Runtime configuration changes applied successfully', { traceId }, {
          configVersion: this.configVersion
        });
      }
      
      return true;
      
    } catch (error) {
      this.logger.error('Configuration update failed', { traceId }, error);
      return false;
    }
  }

  /**
   * Enhanced Start method with health checks and metrics
   */
  protected startMonitoring(): void {
    // Start health checks
    this.startHealthChecks();
    
    // Start metrics collection  
    this.startMetricsCollection();
    
    this.logger.info('Monitoring services started', {}, {
      healthCheckEnabled: this.healthCheckConfig.enabled,
      metricsEnabled: this.metricsConfig.enabled
    });
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T> | T,
    timeout: number,
    operationName: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve(operation())
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Enhanced graceful shutdown with monitoring cleanup
   */
  async gracefulShutdown(options: GracefulShutdownOptions = {}): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Graceful shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    const traceId = generateTraceId();
    const timeout = options.timeout || this.shutdownTimeout;
    const drainDelay = options.drainDelay || this.drainDelay;
    const stepTimeout = options.stepTimeout || Math.floor(timeout / 5);

    this.logger.info('Graceful shutdown started', { traceId }, {
      timeout,
      drainDelay,
      stepTimeout,
      activeConnections: this.getActiveConnectionCount()
    });

    try {
      // Step 1: Stop accepting new connections
      await this.executeWithTimeout(
        () => this.stopAcceptingNewConnections(traceId),
        stepTimeout,
        'Stop accepting new connections'
      );

      // Step 2: Wait for drain delay
      this.logger.info('Step 2: Waiting for drain delay', { traceId }, { drainDelay });
      await new Promise(resolve => setTimeout(resolve, drainDelay));

      // Step 3: Wait for existing connections to complete
      await this.executeWithTimeout(
        () => this.waitForConnectionCompletion(stepTimeout, traceId),
        stepTimeout,
        'Wait for connection completion'
      );

      // Step 4: Force close remaining connections
      await this.executeWithTimeout(
        () => this.forceCloseRemainingConnections(traceId),
        stepTimeout,
        'Force close remaining connections'
      );

      // Step 5: Stop monitoring and cleanup
      this.stopMonitoringAndCleanup(traceId);

      this.logger.info('Graceful shutdown completed', { traceId }, {
        finalConnectionCount: this.getActiveConnectionCount()
      });

    } catch (error) {
      this.logger.error('Graceful shutdown failed, executing force shutdown', { traceId }, error);
      this.forceShutdown(traceId);
      throw error;
    } finally {
      this.isShuttingDown = false;
    }
  }

  /**
   * Stop method with graceful shutdown (required by KoattyServer interface)
   */
  Stop(callback?: (err?: Error) => void): void {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId });

    this.gracefulShutdown()
      .then(() => {
        this.logger.logServerEvent('stopped', { traceId }, { 
          gracefulShutdown: true,
          finalConnectionCount: this.getActiveConnectionCount()
        });
        if (callback) callback();
      })
      .catch((err: Error) => {
        this.logger.error('Graceful shutdown failed, attempting force shutdown', { traceId }, err);
        
        // 回退到强制关闭
        this.forceShutdown(traceId);
        
        this.logger.logServerEvent('stopped', { traceId }, { 
          forcedShutdown: true,
          finalConnectionCount: this.getActiveConnectionCount()
        });
        
        if (callback) callback(err);
      });
  }

  /**
   * Enhanced stopMonitoringAndCleanup to avoid infinite recursion
   */
  protected doStopMonitoringAndCleanup(traceId: string): void {
    this.logger.info('Step 5: Stopping monitoring and cleanup', { traceId });
    
    // Stop health checks and metrics collection
    this.stopHealthChecks();
    this.stopMetricsCollection();
    
    // Call the abstract method for protocol-specific cleanup
    this.stopMonitoringAndCleanup(traceId);
    
    this.logger.debug('Monitoring stopped and cleanup completed', { traceId });
  }

  // ============= 抽象方法 - 子类必须实现 =============

  /**
   * Analyze configuration changes to determine restart requirement
   */
  protected abstract analyzeConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    oldConfig: T,
    newConfig: T
  ): ConfigChangeAnalysis;

  /**
   * Apply configuration changes that don't require restart
   */
  protected abstract applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ): void;

  /**
   * Handle runtime configuration changes
   */
  protected abstract onRuntimeConfigChange(
    analysis: ConfigChangeAnalysis,
    newConfig: Partial<ListeningOptions>,
    traceId: string
  ): void;

  /**
   * Extract relevant configuration for logging
   */
  protected abstract extractRelevantConfig(config: T): any;

  /**
   * Step 1: Stop accepting new connections
   */
  protected abstract stopAcceptingNewConnections(traceId: string): Promise<void>;

  /**
   * Step 3: Wait for existing connections to complete
   */
  protected abstract waitForConnectionCompletion(timeout: number, traceId: string): Promise<void>;

  /**
   * Step 4: Force close remaining connections
   */
  protected abstract forceCloseRemainingConnections(traceId: string): Promise<void>;

  /**
   * Step 5: Stop monitoring and cleanup
   */
  protected abstract stopMonitoringAndCleanup(traceId: string): void;

  /**
   * Force shutdown implementation
   */
  protected abstract forceShutdown(traceId: string): void;

  /**
   * Get active connection count
   */
  protected abstract getActiveConnectionCount(): number;

  /**
   * Get connection statistics
   */
  abstract getConnectionStats?(): ConnectionStats;

  // ============= KoattyServer 接口实现 =============
  abstract Start(listenCallback?: () => void): any;
  abstract getStatus(): number;
  abstract getNativeServer(): NativeServer;

  // ============= 健康检查功能 =============

  /**
   * Start health check monitoring
   */
  protected startHealthChecks(): void {
    if (!this.healthCheckConfig.enabled) return;

    this.healthCheckInterval = setInterval(async () => {
      try {
        this.lastHealthCheck = await this.performHealthCheck();
        this.logger.debug('Health check completed', {}, {
          status: this.lastHealthCheck.status,
          checksCount: Object.keys(this.lastHealthCheck.checks).length
        });
      } catch (error) {
        this.logger.error('Health check failed', {}, error);
        this.lastHealthCheck = {
          status: HealthStatus.UNHEALTHY,
          timestamp: Date.now(),
          uptime: Date.now() - this.startTime,
          checks: {
            general: {
              status: HealthStatus.UNHEALTHY,
              message: 'Health check execution failed',
              details: error
            }
          }
        };
      }
    }, this.healthCheckConfig.interval);

    this.logger.info('Health check monitoring started', {}, {
      interval: this.healthCheckConfig.interval,
      endpoint: this.healthCheckConfig.endpoint
    });
  }

  /**
   * Stop health check monitoring
   */
  protected stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      this.logger.debug('Health check monitoring stopped');
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    let overallStatus = HealthStatus.HEALTHY;

    try {
      // Connection health check
      if (this.healthCheckConfig.checks?.connections) {
        const connectionCheck = await this.checkConnectionHealth();
        checks.connections = connectionCheck;
        if (connectionCheck.status === HealthStatus.UNHEALTHY) {
          overallStatus = HealthStatus.UNHEALTHY;
        } else if (connectionCheck.status === HealthStatus.DEGRADED && overallStatus === HealthStatus.HEALTHY) {
          overallStatus = HealthStatus.DEGRADED;
        }
      }

      // Memory health check
      if (this.healthCheckConfig.checks?.memory) {
        const memoryCheck = this.checkMemoryHealth();
        checks.memory = memoryCheck;
        if (memoryCheck.status === HealthStatus.UNHEALTHY) {
          overallStatus = HealthStatus.UNHEALTHY;
        } else if (memoryCheck.status === HealthStatus.DEGRADED && overallStatus === HealthStatus.HEALTHY) {
          overallStatus = HealthStatus.DEGRADED;
        }
      }

      // Protocol-specific health checks
      const protocolChecks = await this.performProtocolHealthChecks();
      Object.assign(checks, protocolChecks);

      // Check if any protocol-specific check failed
      for (const check of Object.values(protocolChecks)) {
        if (typeof check === 'object' && check && 'status' in check) {
          if (check.status === HealthStatus.UNHEALTHY) {
            overallStatus = HealthStatus.UNHEALTHY;
            break;
          } else if (check.status === HealthStatus.DEGRADED && overallStatus === HealthStatus.HEALTHY) {
            overallStatus = HealthStatus.DEGRADED;
          }
        }
      }

    } catch (error) {
      overallStatus = HealthStatus.UNHEALTHY;
      checks.execution = {
        status: HealthStatus.UNHEALTHY,
        message: 'Health check execution failed',
        details: error
      };
    }

    return {
      status: overallStatus,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      checks
    };
  }

  /**
   * Check connection health
   */
  private async checkConnectionHealth(): Promise<HealthCheckResult['checks'][string]> {
    const activeConnections = this.getActiveConnectionCount();
    const connectionStats = this.getConnectionStats?.();
    
    if (!connectionStats) {
      return {
        status: HealthStatus.HEALTHY,
        message: 'Connection stats not available'
      };
    }

    // Define thresholds (can be made configurable)
    const maxConnections = (this.options as any).maxConnections || 1000;
    const connectionUtilization = activeConnections / maxConnections;
    const errorRate = connectionStats.errorRate;

    let status = HealthStatus.HEALTHY;
    let message = `${activeConnections} active connections`;

    if (connectionUtilization > 0.9 || errorRate > 0.1) {
      status = HealthStatus.UNHEALTHY;
      message = `High connection utilization (${(connectionUtilization * 100).toFixed(1)}%) or error rate (${(errorRate * 100).toFixed(1)}%)`;
    } else if (connectionUtilization > 0.7 || errorRate > 0.05) {
      status = HealthStatus.DEGRADED;
      message = `Moderate connection utilization (${(connectionUtilization * 100).toFixed(1)}%) or error rate (${(errorRate * 100).toFixed(1)}%)`;
    }

    return {
      status,
      message,
      details: {
        activeConnections,
        maxConnections,
        utilization: connectionUtilization,
        errorRate,
        connectionStats
      }
    };
  }

  /**
   * Check memory health
   */
  private checkMemoryHealth(): HealthCheckResult['checks'][string] {
    const memUsage = process.memoryUsage();
    const totalMemory = memUsage.heapTotal;
    const usedMemory = memUsage.heapUsed;
    const memoryUtilization = usedMemory / totalMemory;

    let status = HealthStatus.HEALTHY;
    let message = `Memory usage: ${(memoryUtilization * 100).toFixed(1)}%`;

    if (memoryUtilization > 0.9) {
      status = HealthStatus.UNHEALTHY;
      message = `Critical memory usage: ${(memoryUtilization * 100).toFixed(1)}%`;
    } else if (memoryUtilization > 0.8) {
      status = HealthStatus.DEGRADED;
      message = `High memory usage: ${(memoryUtilization * 100).toFixed(1)}%`;
    }

    return {
      status,
      message,
      details: {
        memoryUsage: memUsage,
        utilization: memoryUtilization
      }
    };
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }

  /**
   * Get active connection count (public method)
   */
  getActiveConnections(): number {
    return this.getActiveConnectionCount();
  }

  // ============= 性能指标功能 =============

  /**
   * Start metrics collection
   */
  protected startMetricsCollection(): void {
    if (!this.metricsConfig.enabled) return;

    this.metricsInterval = setInterval(() => {
      try {
        this.performanceMetrics = this.collectPerformanceMetrics();
        this.addMetricsToHistory(this.performanceMetrics);
        
        this.logger.debug('Performance metrics collected', {}, {
          uptime: this.performanceMetrics.uptime,
          activeConnections: this.performanceMetrics.connections.activeConnections,
          memoryUsage: `${(this.performanceMetrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`
        });
      } catch (error) {
        this.logger.error('Metrics collection failed', {}, error);
      }
    }, this.metricsConfig.interval);

    this.logger.info('Metrics collection started', {}, {
      interval: this.metricsConfig.interval,
      endpoint: this.metricsConfig.endpoint
    });
  }

  /**
   * Stop metrics collection
   */
  protected stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
      this.logger.debug('Metrics collection stopped');
    }
  }

  /**
   * Collect current performance metrics
   */
  collectPerformanceMetrics(): PerformanceMetrics {
    const now = Date.now();
    const uptime = now - this.startTime;
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calculate request rate
    const requestRate = this.requestMetrics.total / (uptime / 1000);
    
    // Calculate average response time
    const avgResponseTime = this.requestMetrics.responseTimes.length > 0
      ? this.requestMetrics.responseTimes.reduce((a, b) => a + b, 0) / this.requestMetrics.responseTimes.length
      : 0;

    // Get connection stats
    const connectionStats = this.getConnectionStats?.() || {
      activeConnections: 0,
      totalConnections: 0,
      connectionsPerSecond: 0,
      averageLatency: 0,
      errorRate: 0
    };

    // Collect protocol-specific metrics
    const customMetrics = this.collectProtocolMetrics();

    const metrics: PerformanceMetrics = {
      uptime,
      memoryUsage,
      cpuUsage,
      connections: connectionStats,
      requests: {
        total: this.requestMetrics.total,
        successful: this.requestMetrics.successful,
        failed: this.requestMetrics.failed,
        rate: requestRate,
        averageResponseTime: avgResponseTime
      },
      performance: {
        gcCount: 0, // Would need gc-stats package for real GC metrics
        gcDuration: 0,
        eventLoopLag: 0, // Would need @nodejs/clinic packages for real metrics
        eventLoopUtilization: 0
      },
      custom: customMetrics
    };

    return metrics;
  }

  /**
   * Add metrics to history and manage retention
   */
  private addMetricsToHistory(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);
    
    // Remove old metrics based on retention policy
    const retentionTime = this.metricsConfig.retention!;
    const cutoffTime = Date.now() - retentionTime;
    
    this.metricsHistory = this.metricsHistory.filter(
      m => (this.startTime + m.uptime) > cutoffTime
    );
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics | null {
    return this.performanceMetrics;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Record request metrics
   */
  recordRequest(successful: boolean, responseTime?: number): void {
    this.requestMetrics.total++;
    if (successful) {
      this.requestMetrics.successful++;
    } else {
      this.requestMetrics.failed++;
    }
    
    if (responseTime !== undefined) {
      this.requestMetrics.responseTimes.push(responseTime);
      // Keep only recent response times (last 1000)
      if (this.requestMetrics.responseTimes.length > 1000) {
        this.requestMetrics.responseTimes = this.requestMetrics.responseTimes.slice(-1000);
      }
    }
  }

  // ============= 抽象方法 - 子类必须实现 =============

  /**
   * Perform protocol-specific health checks
   */
  protected abstract performProtocolHealthChecks(): Promise<Record<string, HealthCheckResult['checks'][string]>>;

  /**
   * Collect protocol-specific metrics
   */
  protected abstract collectProtocolMetrics(): Record<string, any>;
}
