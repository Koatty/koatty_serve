/*
 * @Description: 统一连接池监控管理器
 * @Usage: 合并监控定时器，替代多个独立定时器，优化性能
 * @Author: richen
 * @Date: 2024-11-27 20:30:00
 * @LastEditTime: 2024-11-27 20:30:00
 */

import { createLogger, generateTraceId } from "./logger";
import { TimerManager } from "./timer-manager";

/**
 * 监控任务接口
 */
export interface MonitoringTask {
  name: string;
  interval: number;        // 任务执行间隔（毫秒）
  priority: number;        // 优先级（1-10，数字越小优先级越高）
  execute: () => Promise<void> | void;
  onError?: (error: Error) => void;
  enabled?: boolean;       // 是否启用
  description?: string;    // 描述
}

/**
 * 监控统计信息
 */
export interface MonitoringStats {
  tasksExecuted: number;
  tasksSuccessful: number;
  tasksFailed: number;
  lastExecutionTime: number;
  averageExecutionTime: number;
  uptime: number;
}

/**
 * 监控任务执行结果
 */
export interface TaskExecutionResult {
  taskName: string;
  success: boolean;
  executionTime: number;
  error?: Error;
  timestamp: number;
}

/**
 * 统一连接池监控管理器
 * 解决连接池监控定时器过多的问题，合并相似功能
 */
export class UnifiedPoolMonitor {
  private readonly logger = createLogger({ module: 'unified_monitor' });
  private timerManager: TimerManager;
  private tasks = new Map<string, MonitoringTask>();
  private taskStats = new Map<string, MonitoringStats>();
  private monitoringInterval = 5000; // 统一监控间隔5秒
  private isRunning = false;
  private startTime = 0;
  private lastExecutionTimes = new Map<string, number>();

  constructor(private protocol: string, monitoringInterval = 5000) {
    this.timerManager = new TimerManager();
    this.monitoringInterval = monitoringInterval;
  }

  /**
   * 注册监控任务
   */
  registerTask(task: MonitoringTask): void {
    if (this.tasks.has(task.name)) {
      this.logger.warn('Monitoring task already exists, replacing', {}, {
        taskName: task.name,
        protocol: this.protocol
      });
    }

    // 设置默认值
    const normalizedTask: MonitoringTask = {
      ...task,
      enabled: task.enabled !== false,
      description: task.description || `Monitoring task: ${task.name}`
    };

    this.tasks.set(task.name, normalizedTask);
    
    // 初始化统计信息
    this.taskStats.set(task.name, {
      tasksExecuted: 0,
      tasksSuccessful: 0,
      tasksFailed: 0,
      lastExecutionTime: 0,
      averageExecutionTime: 0,
      uptime: 0
    });

    this.logger.debug('Monitoring task registered', {}, {
      taskName: task.name,
      interval: task.interval,
      priority: task.priority,
      protocol: this.protocol
    });
  }

  /**
   * 注销监控任务
   */
  unregisterTask(taskName: string): void {
    if (this.tasks.delete(taskName)) {
      this.taskStats.delete(taskName);
      this.lastExecutionTimes.delete(taskName);
      
      this.logger.debug('Monitoring task unregistered', {}, {
        taskName,
        protocol: this.protocol
      });
    }
  }

  /**
   * 启用/禁用任务
   */
  setTaskEnabled(taskName: string, enabled: boolean): void {
    const task = this.tasks.get(taskName);
    if (task) {
      task.enabled = enabled;
      this.logger.debug('Monitoring task status changed', {}, {
        taskName,
        enabled,
        protocol: this.protocol
      });
    }
  }

  /**
   * 开始监控
   */
  startMonitoring(): void {
    if (this.isRunning) {
      this.logger.warn('Unified monitoring already running', {}, { protocol: this.protocol });
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    this.timerManager.addTimer('unified_monitoring', () => {
      this.executeMonitoringCycle();
    }, this.monitoringInterval);

    this.logger.info('Unified monitoring started', {}, {
      interval: this.monitoringInterval,
      tasksCount: this.tasks.size,
      protocol: this.protocol
    });
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.timerManager.destroy();

    this.logger.info('Unified monitoring stopped', {}, {
      protocol: this.protocol,
      uptime: Date.now() - this.startTime
    });
  }

  /**
   * 执行监控周期
   */
  private async executeMonitoringCycle(): Promise<void> {
    const currentTime = Date.now();
    const traceId = generateTraceId();
    
    // 获取需要执行的任务（按优先级排序）
    const tasksToExecute = this.getTasksToExecute(currentTime);
    
    if (tasksToExecute.length === 0) {
      return;
    }

    this.logger.debug('Executing monitoring cycle', { traceId }, {
      tasksCount: tasksToExecute.length,
      protocol: this.protocol
    });

    // 并行执行相同优先级的任务，串行执行不同优先级的任务
    const tasksByPriority = this.groupTasksByPriority(tasksToExecute);
    
    for (const [priority, tasks] of tasksByPriority) {
      await this.executePriorityGroup(tasks, priority, traceId);
    }
  }

  /**
   * 获取需要执行的任务
   */
  private getTasksToExecute(currentTime: number): MonitoringTask[] {
    const tasksToExecute: MonitoringTask[] = [];

    for (const [taskName, task] of this.tasks) {
      if (!task.enabled) {
        continue;
      }

      const lastExecution = this.lastExecutionTimes.get(taskName) || 0;
      if (currentTime - lastExecution >= task.interval) {
        tasksToExecute.push(task);
      }
    }

    return tasksToExecute.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 按优先级分组任务
   */
  private groupTasksByPriority(tasks: MonitoringTask[]): Map<number, MonitoringTask[]> {
    const grouped = new Map<number, MonitoringTask[]>();

    for (const task of tasks) {
      const priority = task.priority;
      if (!grouped.has(priority)) {
        grouped.set(priority, []);
      }
      grouped.get(priority)!.push(task);
    }

    return grouped;
  }

  /**
   * 执行同优先级任务组
   */
  private async executePriorityGroup(
    tasks: MonitoringTask[], 
    priority: number, 
    traceId: string
  ): Promise<void> {
    this.logger.debug(`Executing priority ${priority} tasks`, { traceId }, {
      tasksCount: tasks.length,
      taskNames: tasks.map(t => t.name)
    });

    // 并行执行同优先级任务
    const promises = tasks.map(task => this.executeTask(task, traceId));
    await Promise.allSettled(promises);
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: MonitoringTask, traceId: string): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const stats = this.taskStats.get(task.name)!;
    
    try {
      await task.execute();
      
      const executionTime = Date.now() - startTime;
      this.lastExecutionTimes.set(task.name, startTime);
      
      // 更新统计信息
      stats.tasksExecuted++;
      stats.tasksSuccessful++;
      stats.lastExecutionTime = executionTime;
      stats.averageExecutionTime = this.calculateAverageExecutionTime(stats, executionTime);
      stats.uptime = Date.now() - this.startTime;

      this.logger.debug(`Task executed successfully: ${task.name}`, { traceId }, {
        executionTime,
        protocol: this.protocol
      });

      return {
        taskName: task.name,
        success: true,
        executionTime,
        timestamp: startTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // 更新统计信息
      stats.tasksExecuted++;
      stats.tasksFailed++;
      stats.lastExecutionTime = executionTime;
      stats.uptime = Date.now() - this.startTime;

      // 调用错误处理器
      if (task.onError) {
        try {
          task.onError(error as Error);
        } catch (handlerError) {
          this.logger.error(`Task error handler failed: ${task.name}`, { traceId }, handlerError);
        }
      }

      this.logger.error(`Task execution failed: ${task.name}`, { traceId }, error);

      return {
        taskName: task.name,
        success: false,
        executionTime,
        error: error as Error,
        timestamp: startTime
      };
    }
  }

  /**
   * 计算平均执行时间
   */
  private calculateAverageExecutionTime(stats: MonitoringStats, newTime: number): number {
    if (stats.tasksExecuted === 1) {
      return newTime;
    }
    
    const weight = 0.1; // 新值权重
    return stats.averageExecutionTime * (1 - weight) + newTime * weight;
  }

  /**
   * 获取任务统计信息
   */
  getTaskStats(taskName?: string): MonitoringStats | Map<string, MonitoringStats> {
    if (taskName) {
      return this.taskStats.get(taskName) || {
        tasksExecuted: 0,
        tasksSuccessful: 0,
        tasksFailed: 0,
        lastExecutionTime: 0,
        averageExecutionTime: 0,
        uptime: 0
      };
    }
    
    return new Map(this.taskStats);
  }

  /**
   * 获取监控器状态
   */
  getMonitorStatus(): {
    isRunning: boolean;
    uptime: number;
    tasksCount: number;
    enabledTasksCount: number;
    totalExecutions: number;
    totalSuccesses: number;
    totalFailures: number;
  } {
    let totalExecutions = 0;
    let totalSuccesses = 0;
    let totalFailures = 0;

    for (const stats of this.taskStats.values()) {
      totalExecutions += stats.tasksExecuted;
      totalSuccesses += stats.tasksSuccessful;
      totalFailures += stats.tasksFailed;
    }

    const enabledTasksCount = Array.from(this.tasks.values())
      .filter(task => task.enabled).length;

    return {
      isRunning: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      tasksCount: this.tasks.size,
      enabledTasksCount,
      totalExecutions,
      totalSuccesses,
      totalFailures
    };
  }

  /**
   * 获取任务列表
   */
  getTasks(): Array<{
    name: string;
    interval: number;
    priority: number;
    enabled: boolean;
    description: string;
    stats: MonitoringStats;
  }> {
    return Array.from(this.tasks.entries()).map(([name, task]) => ({
      name,
      interval: task.interval,
      priority: task.priority,
      enabled: task.enabled || false,
      description: task.description || '',
      stats: this.taskStats.get(name) || {
        tasksExecuted: 0,
        tasksSuccessful: 0,
        tasksFailed: 0,
        lastExecutionTime: 0,
        averageExecutionTime: 0,
        uptime: 0
      }
    }));
  }

  /**
   * 销毁监控器
   */
  destroy(): void {
    this.stopMonitoring();
    this.tasks.clear();
    this.taskStats.clear();
    this.lastExecutionTimes.clear();
    
    this.logger.debug('Unified pool monitor destroyed', {}, { protocol: this.protocol });
  }
}

/**
 * 常用监控任务工厂
 */
export class MonitoringTaskFactory {
  
  /**
   * 健康检查任务
   */
  static createHealthCheckTask(
    healthCheckFn: () => Promise<void> | void,
    interval = 5000
  ): MonitoringTask {
    return {
      name: 'health_check',
      interval,
      priority: 1,
      execute: healthCheckFn,
      description: 'Pool health check monitoring'
    };
  }

  /**
   * 清理过期连接任务
   */
  static createCleanupTask(
    cleanupFn: () => Promise<void> | void,
    interval = 30000
  ): MonitoringTask {
    return {
      name: 'cleanup_expired',
      interval,
      priority: 3,
      execute: cleanupFn,
      description: 'Cleanup expired connections'
    };
  }

  /**
   * 协议特定ping任务
   */
  static createPingTask(
    pingFn: () => Promise<void> | void,
    interval = 30000,
    protocolName = 'generic'
  ): MonitoringTask {
    return {
      name: `${protocolName}_ping`,
      interval,
      priority: 2,
      execute: pingFn,
      description: `${protocolName.toUpperCase()} ping monitoring`
    };
  }

  /**
   * 心跳任务
   */
  static createHeartbeatTask(
    heartbeatFn: () => Promise<void> | void,
    interval = 20000
  ): MonitoringTask {
    return {
      name: 'heartbeat',
      interval,
      priority: 2,
      execute: heartbeatFn,
      description: 'Connection heartbeat monitoring'
    };
  }

  /**
   * 安全监控任务
   */
  static createSecurityMonitoringTask(
    securityFn: () => Promise<void> | void,
    interval = 60000
  ): MonitoringTask {
    return {
      name: 'security_monitoring',
      interval,
      priority: 4,
      execute: securityFn,
      description: 'Security monitoring and analysis'
    };
  }

  /**
   * 性能指标收集任务
   */
  static createMetricsCollectionTask(
    metricsFn: () => Promise<void> | void,
    interval = 10000
  ): MonitoringTask {
    return {
      name: 'metrics_collection',
      interval,
      priority: 5,
      execute: metricsFn,
      description: 'Performance metrics collection'
    };
  }
} 