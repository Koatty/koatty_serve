/*
 * @Description: 统一优雅关闭逻辑
 * @Usage: 解决各服务器类优雅关闭步骤的代码重复问题
 * @Author: richen
 * @Date: 2024-11-27 20:30:00
 * @LastEditTime: 2024-11-27 20:30:00
 */

import { createLogger, generateTraceId } from "./logger";

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
 * 内部状态跟踪接口
 */
interface InternalShutdownStatus {
  isInProgress: boolean;
  currentStep: string;
  startTime: number;
  completedSteps: string[];
  failedSteps: Array<{
    step: string;
    error: string;
    timestamp: number;
  }>;
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
    error: string;
    timestamp: number;
  }>;
}

/**
 * 优雅关闭管理器
 * 提供统一的优雅关闭流程管理，支持多步骤关闭和详细状态跟踪
 * 
 * 性能优化：
 * - 移除不必要的 TimerManager 依赖
 * - 优化日志记录频率
 * - 统一超时机制
 */
export class GracefulShutdownManager {
  private isShuttingDown = false;
  private shutdownStartTime = 0;
  private logger = createLogger({ module: 'graceful-shutdown' });
  private currentStatus: InternalShutdownStatus = {
    isInProgress: false,
    currentStep: '',
    startTime: 0,
    completedSteps: [],
    failedSteps: []
  };

  constructor(private protocol: string) {
    // 移除 TimerManager 实例化以减少资源消耗
    this.logger = createLogger({
      module: 'graceful-shutdown',
      protocol: this.protocol
    });
  }

  /**
   * 检查是否正在关闭中
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * 获取当前关闭状态
   */
  getStatus(): ShutdownStatus {
    if (!this.currentStatus.isInProgress) {
      return ShutdownStatus.NOT_STARTED;
    }
    return ShutdownStatus.IN_PROGRESS;
  }

  /**
   * 执行优雅关闭流程
   * 优化：减少日志记录频率，统一错误处理
   */
  async performGracefulShutdown(
    steps: ShutdownStep[],
    options: GracefulShutdownOptions = {}
  ): Promise<ShutdownResult> {
    if (this.isShuttingDown) {
      throw new Error('Graceful shutdown already in progress');
    }

    this.isShuttingDown = true;
    this.shutdownStartTime = Date.now();
    
    // 初始化状态
    this.currentStatus = {
      isInProgress: true,
      currentStep: '',
      startTime: this.shutdownStartTime,
      completedSteps: [],
      failedSteps: []
    };

    const timeout = options.timeout || 30000;
    const drainDelay = options.drainDelay || 5000;
    
    // 优化：减少日志记录，只记录关键信息
    this.logger.info('Graceful shutdown initiated', {}, {
      protocol: this.protocol,
      totalSteps: steps.length,
      timeout,
      drainDelay
    });

    try {
      // 使用统一的超时控制
      const result = await this.executeWithGlobalTimeout(
        () => this.executeShutdownSteps(steps, drainDelay),
        timeout
      );

      const totalTime = Date.now() - this.shutdownStartTime;
      
      this.logger.info('Graceful shutdown completed', {}, {
        status: result.status,
        totalTime,
        completedSteps: result.completedSteps.length,
        failedSteps: result.failedSteps.length
      });

      return {
        ...result,
        totalTime
      };

    } catch (error) {
      const totalTime = Date.now() - this.shutdownStartTime;
      
      this.logger.error('Graceful shutdown failed', {}, {
        error: error instanceof Error ? error.message : String(error),
        totalTime
      });

      return {
        status: ShutdownStatus.FAILED,
        completedSteps: this.currentStatus.completedSteps,
        failedSteps: [...this.currentStatus.failedSteps, {
          step: 'global',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        }],
        totalTime
      };

    } finally {
      this.isShuttingDown = false;
      this.currentStatus.isInProgress = false;
    }
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
            error: error as string,
            timestamp: Date.now()
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
    this.currentStatus.isInProgress = true;
    this.logger.info('Starting drain delay', { traceId }, { drainDelay });
    
    await new Promise(resolve => setTimeout(resolve, drainDelay));
    
    this.logger.debug('Drain delay completed', { traceId });
  }

  /**
   * 设置强制关闭定时器（已优化，移除不必要的实现）
   */
  private setupForceShutdownTimer(
    _timeout: number, 
    _traceId: string, 
    _result: ShutdownResult
  ): void {
    // 已通过 executeWithGlobalTimeout 统一处理超时
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
        error: reason,
        timestamp: Date.now()
      }]
    };
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    // 清理资源，目前无需特殊处理
  }

  /**
   * 执行各个关闭步骤
   */
  private async executeShutdownSteps(steps: ShutdownStep[], drainDelay: number): Promise<ShutdownResult> {
    const traceId = generateTraceId();
    
    // 执行各个关闭步骤
    for (const step of steps) {
      this.currentStatus.currentStep = step.name;
      
      try {
        await this.executeWithTimeout(
          () => step.execute(traceId),
          step.timeout || 5000,
          step.name
        );
        
        this.currentStatus.completedSteps.push(step.name);
        
      } catch (error) {
        this.currentStatus.failedSteps.push({
          step: step.name,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        });
        
        if (step.isRequired !== false) {
          throw error;
        }
      }
    }

    // 等待排空延迟
    if (drainDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, drainDelay));
    }

    return {
      status: ShutdownStatus.COMPLETED,
      completedSteps: this.currentStatus.completedSteps,
      failedSteps: this.currentStatus.failedSteps,
      totalTime: 0 // 将在调用方设置
    };
  }

  /**
   * 执行全局超时控制
   */
  private async executeWithGlobalTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Global timeout of ${timeout}ms exceeded`));
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