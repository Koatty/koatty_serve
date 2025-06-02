/*
 * @Description: Structured logging utilities based on koatty_logger
 * @Usage: 
 * @Author: richen
 * @Date: 2025-01-27 12:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { DefaultLogger as Logger } from "koatty_logger";
import { performance } from "perf_hooks";

/**
 * Log context interface
 */
export interface LogContext {
  module?: string;          // 模块名 (如: HTTP, WebSocket, gRPC)
  protocol?: string;        // 协议类型
  serverId?: string;        // 服务器实例ID
  connectionId?: string;    // 连接ID
  requestId?: string;       // 请求ID
  userId?: string;          // 用户ID
  sessionId?: string;       // 会话ID
  traceId?: string;         // 追踪ID
  action?: string;          // 操作类型
  [key: string]: any;       // 其他自定义字段
}

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryUsage?: NodeJS.MemoryUsage;
  [key: string]: any;
}

/**
 * Structured logger class based on koatty_logger
 */
export class StructuredLogger {
  private static instance: StructuredLogger;
  private globalContext: LogContext = {};
  private performanceTrackers = new Map<string, PerformanceMetrics>();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger();
    }
    return StructuredLogger.instance;
  }

  /**
   * Set global context for all logs
   */
  setGlobalContext(context: LogContext): void {
    this.globalContext = { ...this.globalContext, ...context };
  }

  /**
   * Clear global context
   */
  clearGlobalContext(): void {
    this.globalContext = {};
  }

  /**
   * Format log message with context
   */
  private formatMessage(message: string, context?: LogContext, data?: any): string {
    const mergedContext = { ...this.globalContext, ...context };
    const parts: string[] = [];

    // Add module prefix if available
    if (mergedContext.module) {
      parts.push(`[${mergedContext.module.toUpperCase()}]`);
    }

    // Add protocol if available
    if (mergedContext.protocol) {
      parts.push(`[${mergedContext.protocol.toUpperCase()}]`);
    }

    // Add server/connection identifiers
    if (mergedContext.serverId) {
      parts.push(`[Server:${mergedContext.serverId}]`);
    }

    if (mergedContext.connectionId) {
      parts.push(`[Conn:${mergedContext.connectionId}]`);
    }

    // Add action if available
    if (mergedContext.action) {
      parts.push(`[${mergedContext.action}]`);
    }

    // Build final message
    const prefix = parts.length > 0 ? `${parts.join(' ')} ` : '';
    let finalMessage = `${prefix}${message}`;

    // Add structured data if provided
    if (data) {
      const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
      finalMessage += ` | Data: ${dataStr}`;
    }

    // Add trace ID for correlation
    if (mergedContext.traceId) {
      finalMessage += ` | TraceId: ${mergedContext.traceId}`;
    }

    return finalMessage;
  }

  /**
   * Debug level logging
   */
  debug(message: string, context?: LogContext, data?: any): void {
    const formattedMessage = this.formatMessage(message, context, data);
    Logger.Debug(formattedMessage);
  }

  /**
   * Info level logging
   */
  info(message: string, context?: LogContext, data?: any): void {
    const formattedMessage = this.formatMessage(message, context, data);
    Logger.Info(formattedMessage);
  }

  /**
   * Warning level logging
   */
  warn(message: string, context?: LogContext, data?: any): void {
    const formattedMessage = this.formatMessage(message, context, data);
    Logger.Warn(formattedMessage);
  }

  /**
   * Error level logging
   */
  error(message: string, context?: LogContext, error?: Error | any): void {
    const errorData = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error;

    const formattedMessage = this.formatMessage(message, context, errorData);
    Logger.Error(formattedMessage);
  }

  /**
   * Start performance tracking
   */
  startPerformanceTracking(trackingId: string, context?: LogContext): void {
    const metrics: PerformanceMetrics = {
      startTime: performance.now(),
      memoryUsage: process.memoryUsage()
    };

    this.performanceTrackers.set(trackingId, metrics);
    
    this.debug(`Performance tracking started`, 
      { ...context, action: 'perf_start' }, 
      { trackingId }
    );
  }

  /**
   * End performance tracking and log results
   */
  endPerformanceTracking(trackingId: string, context?: LogContext): PerformanceMetrics | null {
    const metrics = this.performanceTrackers.get(trackingId);
    if (!metrics) {
      this.warn(`Performance tracking not found`, context, { trackingId });
      return null;
    }

    metrics.endTime = performance.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    
    const currentMemory = process.memoryUsage();
    const memoryDiff = {
      heapUsed: currentMemory.heapUsed - metrics.memoryUsage!.heapUsed,
      heapTotal: currentMemory.heapTotal - metrics.memoryUsage!.heapTotal,
      external: currentMemory.external - metrics.memoryUsage!.external
    };

    this.info(`Performance tracking completed`, 
      { ...context, action: 'perf_end' }, 
      { 
        trackingId,
        duration: `${metrics.duration.toFixed(2)}ms`,
        memoryDiff 
      }
    );

    this.performanceTrackers.delete(trackingId);
    return metrics;
  }

  /**
   * Log server lifecycle events
   */
  logServerEvent(event: 'starting' | 'started' | 'stopping' | 'stopped' | 'error', 
                 context: LogContext, 
                 data?: any): void {
    const eventContext = { ...context, action: `server_${event}` };
    
    switch (event) {
      case 'starting':
        this.info(`Server starting`, eventContext, data);
        break;
      case 'started':
        this.info(`Server started successfully`, eventContext, data);
        break;
      case 'stopping':
        this.info(`Server stopping`, eventContext, data);
        break;
      case 'stopped':
        this.info(`Server stopped successfully`, eventContext, data);
        break;
      case 'error':
        this.error(`Server error occurred`, eventContext, data);
        break;
    }
  }

  /**
   * Log connection events
   */
  logConnectionEvent(event: 'connected' | 'disconnected' | 'error' | 'timeout',
                     context: LogContext,
                     data?: any): void {
    const eventContext = { ...context, action: `connection_${event}` };
    
    switch (event) {
      case 'connected':
        this.info(`Connection established`, eventContext, data);
        break;
      case 'disconnected':
        this.info(`Connection closed`, eventContext, data);
        break;
      case 'error':
        this.error(`Connection error`, eventContext, data);
        break;
      case 'timeout':
        this.warn(`Connection timeout`, eventContext, data);
        break;
    }
  }

  /**
   * Log security events
   */
  logSecurityEvent(event: 'auth_success' | 'auth_failure' | 'rate_limit' | 'blocked',
                   context: LogContext,
                   data?: any): void {
    const eventContext = { ...context, action: `security_${event}` };
    
    switch (event) {
      case 'auth_success':
        this.info(`Authentication successful`, eventContext, data);
        break;
      case 'auth_failure':
        this.warn(`Authentication failed`, eventContext, data);
        break;
      case 'rate_limit':
        this.warn(`Rate limit exceeded`, eventContext, data);
        break;
      case 'blocked':
        this.warn(`Request blocked`, eventContext, data);
        break;
    }
  }

  /**
   * Create a child logger with preset context
   */
  createChildLogger(childContext: LogContext): ChildLogger {
    return new ChildLogger(this, { ...this.globalContext, ...childContext });
  }
}

/**
 * Child logger with preset context
 */
export class ChildLogger {
  constructor(
    private parent: StructuredLogger,
    private childContext: LogContext
  ) {}

  debug(message: string, additionalContext?: LogContext, data?: any): void {
    this.parent.debug(message, { ...this.childContext, ...additionalContext }, data);
  }

  info(message: string, additionalContext?: LogContext, data?: any): void {
    this.parent.info(message, { ...this.childContext, ...additionalContext }, data);
  }

  warn(message: string, additionalContext?: LogContext, data?: any): void {
    this.parent.warn(message, { ...this.childContext, ...additionalContext }, data);
  }

  error(message: string, additionalContext?: LogContext, error?: Error | any): void {
    this.parent.error(message, { ...this.childContext, ...additionalContext }, error);
  }

  logServerEvent(event: 'starting' | 'started' | 'stopping' | 'stopped' | 'error', 
                 additionalContext?: LogContext, 
                 data?: any): void {
    this.parent.logServerEvent(event, { ...this.childContext, ...additionalContext }, data);
  }

  logConnectionEvent(event: 'connected' | 'disconnected' | 'error' | 'timeout',
                     additionalContext?: LogContext,
                     data?: any): void {
    this.parent.logConnectionEvent(event, { ...this.childContext, ...additionalContext }, data);
  }

  logSecurityEvent(event: 'auth_success' | 'auth_failure' | 'rate_limit' | 'blocked',
                   additionalContext?: LogContext,
                   data?: any): void {
    this.parent.logSecurityEvent(event, { ...this.childContext, ...additionalContext }, data);
  }

  startPerformanceTracking(trackingId: string, additionalContext?: LogContext): void {
    this.parent.startPerformanceTracking(trackingId, { ...this.childContext, ...additionalContext });
  }

  endPerformanceTracking(trackingId: string, additionalContext?: LogContext): PerformanceMetrics | null {
    return this.parent.endPerformanceTracking(trackingId, { ...this.childContext, ...additionalContext });
  }
}

// Export singleton instance
export const structuredLogger = StructuredLogger.getInstance();

// Export convenience functions
export const createLogger = (context: LogContext) => structuredLogger.createChildLogger(context);

// Generate unique IDs for tracking
export const generateTraceId = () => `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
export const generateConnectionId = () => `conn_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
export const generateRequestId = () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`; 