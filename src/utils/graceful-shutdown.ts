/*
 * @Description: 统一优雅关闭逻辑
 * @Usage: 解决各服务器类优雅关闭步骤的代码重复问题
 * @Author: richen
 * @Date: 2024-11-27 20:30:00
 * @LastEditTime: 2024-11-27 20:30:00
 */

import { createLogger, generateTraceId } from "./logger";
import { TimerManager } from "./timer-manager";

/**
 * 优雅关闭步骤接口
 */
export interface ShutdownStep {
  name: string;
  description: string;
  timeout?: number;
  execute: (traceId: string) => Promise<void>;
  isRequired?: boolean;  // 是否为必需步骤
  retryCount?: number;   // 重试次数
}

/**
 * 优雅关闭选项
 */
export interface GracefulShutdownOptions {
  timeout?: number;        // 总超时时间
  drainDelay?: number;     // 排空延迟
  stepTimeout?: number;    // 单步超时
  forceTimeout?: number;   // 强制关闭超时
  steps?: ShutdownStep[];  // 自定义步骤
}

/**
 * 优雅关闭状态
 */
export enum ShutdownStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress', 
  DRAINING = 'draining',
  COMPLETING = 'completing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  FORCED = 'forced'
}

/**
 * 优雅关闭结果
 */
export interface ShutdownResult {
  status: ShutdownStatus;
  totalTime: number;
  completedSteps: string[];
  failedSteps: Array<{
    step: string;
    error: Error;
    retryAttempts: number;
  }>;
  forcedShutdown: boolean;
}

/**
 * 统一优雅关闭管理器
 * 解决各协议服务器中90%相似的关闭逻辑代码重复问题
 */
export class GracefulShutdownManager {
  private readonly logger = createLogger({ module: 'graceful_shutdown' });
  private isShuttingDown = false;
  private shutdownStatus = ShutdownStatus.NOT_STARTED;
  private timerManager: TimerManager;
  private forceShutdownTimer?: NodeJS.Timeout;

  constructor(private protocol: string) {
    this.timerManager = new TimerManager();
  }

  /**
   * 执行优雅关闭流程
   * @param steps 关闭步骤
   * @param options 关闭选项
   */
  async performGracefulShutdown(
    steps: ShutdownStep[], 
    options: GracefulShutdownOptions = {}
  ): Promise<ShutdownResult> {
    if (this.isShuttingDown) {
      this.logger.warn('Graceful shutdown already in progress', {}, { protocol: this.protocol });
      return this.createFailedResult('Shutdown already in progress');
    }

    this.isShuttingDown = true;
    this.shutdownStatus = ShutdownStatus.IN_PROGRESS;
    
    const traceId = generateTraceId();
    const startTime = Date.now();
    const timeout = options.timeout || 30000;
    const stepTimeout = options.stepTimeout || Math.floor(timeout / 5);
    
    const result: ShutdownResult = {
      status: ShutdownStatus.IN_PROGRESS,
      totalTime: 0,
      completedSteps: [],
      failedSteps: [],
      forcedShutdown: false
    };

    this.logger.info('Graceful shutdown started', { traceId }, {
      protocol: this.protocol,
      totalSteps: steps.length,
      timeout,
      stepTimeout
    });

    // 设置强制关闭定时器
    this.setupForceShutdownTimer(timeout, traceId, result);

    try {
      // 执行各个关闭步骤
      for (const step of steps) {
        if (result.forcedShutdown) {
          break;
        }

        await this.executeShutdownStep(step, stepTimeout, traceId, result);
      }

      // 等待排空延迟
      if (options.drainDelay && result.status !== ShutdownStatus.FORCED) {
        await this.performDrainDelay(options.drainDelay, traceId);
      }

      // 完成关闭
      this.shutdownStatus = ShutdownStatus.COMPLETED;
      result.status = ShutdownStatus.COMPLETED;

      this.logger.info('Graceful shutdown completed successfully', { traceId }, {
        protocol: this.protocol,
        completedSteps: result.completedSteps.length,
        failedSteps: result.failedSteps.length,
        totalTime: Date.now() - startTime
      });

    } catch (error) {
      this.shutdownStatus = ShutdownStatus.FAILED;
      result.status = ShutdownStatus.FAILED;
      this.logger.error('Graceful shutdown failed', { traceId }, error);
    } finally {
      result.totalTime = Date.now() - startTime;
      this.cleanup();
    }

    return result;
  }

  /**
   * 执行单个关闭步骤
   */
  private async executeShutdownStep(
    step: ShutdownStep,
    defaultTimeout: number,
    traceId: string,
    result: ShutdownResult
  ): Promise<void> {
    const stepTimeout = step.timeout || defaultTimeout;
    const maxRetries = step.retryCount || 0;
    let retryAttempts = 0;

    this.logger.info(`Executing shutdown step: ${step.name}`, { traceId }, {
      description: step.description,
      timeout: stepTimeout,
      isRequired: step.isRequired !== false
    });

    while (retryAttempts <= maxRetries) {
      try {
        await this.executeWithTimeout(
          () => step.execute(traceId),
          stepTimeout,
          `Shutdown step: ${step.name}`
        );

        result.completedSteps.push(step.name);
        this.logger.debug(`Shutdown step completed: ${step.name}`, { traceId });
        return;

      } catch (error) {
        retryAttempts++;
        
        if (retryAttempts <= maxRetries) {
          this.logger.warn(`Shutdown step ${step.name} failed, retrying (${retryAttempts}/${maxRetries})`, 
            { traceId }, error);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryAttempts));
        } else {
          result.failedSteps.push({
            step: step.name,
            error: error as Error,
            retryAttempts
          });

          if (step.isRequired !== false) {
            this.logger.error(`Required shutdown step failed: ${step.name}`, { traceId }, error);
            throw error;
          } else {
            this.logger.warn(`Optional shutdown step failed: ${step.name}`, { traceId }, error);
          }
        }
      }
    }
  }

  /**
   * 执行排空延迟
   */
  private async performDrainDelay(drainDelay: number, traceId: string): Promise<void> {
    this.shutdownStatus = ShutdownStatus.DRAINING;
    this.logger.info('Starting drain delay', { traceId }, { drainDelay });
    
    await new Promise(resolve => setTimeout(resolve, drainDelay));
    
    this.logger.debug('Drain delay completed', { traceId });
  }

  /**
   * 设置强制关闭定时器
   */
  private setupForceShutdownTimer(
    timeout: number, 
    traceId: string, 
    result: ShutdownResult
  ): void {
    this.forceShutdownTimer = setTimeout(() => {
      if (this.shutdownStatus !== ShutdownStatus.COMPLETED) {
        this.logger.warn('Forcing shutdown due to timeout', { traceId }, {
          timeout,
          currentStatus: this.shutdownStatus
        });
        
        this.shutdownStatus = ShutdownStatus.FORCED;
        result.status = ShutdownStatus.FORCED;
        result.forcedShutdown = true;
      }
    }, timeout);
  }

  /**
   * 带超时的执行函数
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    description: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${description} timed out after ${timeout}ms`));
      }, timeout);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(reason: string): ShutdownResult {
    return {
      status: ShutdownStatus.FAILED,
      totalTime: 0,
      completedSteps: [],
      failedSteps: [{
        step: 'initialization',
        error: new Error(reason),
        retryAttempts: 0
      }],
      forcedShutdown: false
    };
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.forceShutdownTimer) {
      clearTimeout(this.forceShutdownTimer);
      this.forceShutdownTimer = undefined;
    }
    
    this.timerManager.destroy();
    this.isShuttingDown = false;
  }

  /**
   * 获取当前关闭状态
   */
  getShutdownStatus(): ShutdownStatus {
    return this.shutdownStatus;
  }

  /**
   * 检查是否正在关闭
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.cleanup();
  }
}

/**
 * 常用的关闭步骤工厂
 */
export class ShutdownStepFactory {
  
  /**
   * 停止接受新连接步骤
   */
  static createStopAcceptingStep(
    stopFn: (traceId: string) => Promise<void>,
    timeout = 5000
  ): ShutdownStep {
    return {
      name: 'stop_accepting_connections',
      description: 'Stop accepting new connections',
      timeout,
      execute: stopFn,
      isRequired: true
    };
  }

  /**
   * 等待现有连接完成步骤
   */
  static createWaitConnectionsStep(
    waitFn: (timeout: number, traceId: string) => Promise<void>,
    timeout = 15000
  ): ShutdownStep {
    return {
      name: 'wait_connections_completion',
      description: 'Wait for existing connections to complete',
      timeout,
      execute: (traceId) => waitFn(timeout, traceId),
      isRequired: true,
      retryCount: 1
    };
  }

  /**
   * 强制关闭剩余连接步骤
   */
  static createForceCloseStep(
    closeFn: (traceId: string) => Promise<void>,
    timeout = 5000
  ): ShutdownStep {
    return {
      name: 'force_close_connections',
      description: 'Force close remaining connections',
      timeout,
      execute: closeFn,
      isRequired: true
    };
  }

  /**
   * 停止监控和清理步骤
   */
  static createStopMonitoringStep(
    stopFn: (traceId: string) => void,
    timeout = 3000
  ): ShutdownStep {
    return {
      name: 'stop_monitoring_cleanup',
      description: 'Stop monitoring and cleanup resources',
      timeout,
      execute: async (traceId) => stopFn(traceId),
      isRequired: false
    };
  }

  /**
   * 协议特定的强制关闭步骤
   */
  static createProtocolShutdownStep(
    shutdownFn: (traceId: string) => void,
    protocolName: string,
    timeout = 3000
  ): ShutdownStep {
    return {
      name: `${protocolName}_force_shutdown`,
      description: `Force shutdown ${protocolName} specific resources`,
      timeout,
      execute: async (traceId) => shutdownFn(traceId),
      isRequired: true
    };
  }
} 