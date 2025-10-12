/**
 * Terminus 优雅关闭测试
 * 验证 appStop 事件触发时 gracefulShutdown 被正确调用
 */

import { EventEmitter } from 'events';
import { KoattyApplication, KoattyServer } from 'koatty_core';
import { onSignal } from '../src/utils/terminus';

describe('Terminus Graceful Shutdown', () => {
  let mockApp: KoattyApplication;
  let mockServer: any;
  let gracefulShutdownCalled: boolean;
  let stopCalled: boolean;
  let appStopCalled: boolean;

  beforeEach(() => {
    gracefulShutdownCalled = false;
    stopCalled = false;
    appStopCalled = false;

    // 创建模拟的 app
    mockApp = new EventEmitter() as any;
    mockApp.on('appStop', () => {
      appStopCalled = true;
    });

    // 创建模拟的 server
    mockServer = {
      status: 200,
      gracefulShutdown: jest.fn().mockImplementation(async (options: any) => {
        gracefulShutdownCalled = true;
        return {
          status: 'completed',
          totalTime: 100,
          completedSteps: ['test'],
          failedSteps: []
        };
      }),
      Stop: jest.fn().mockImplementation((callback?: Function) => {
        stopCalled = true;
        if (callback) callback();
      })
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('appStop 事件触发后应该调用 gracefulShutdown', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    try {
      await onSignal('SIGTERM', mockApp, mockServer as KoattyServer, 5000);
    } catch (error: any) {
      if (error.message === 'process.exit called') {
        // 预期的退出
      } else {
        throw error;
      }
    }

    expect(appStopCalled).toBe(true);
    expect(gracefulShutdownCalled).toBe(true);
    expect(mockServer.gracefulShutdown).toHaveBeenCalledWith({ timeout: 5000 });
    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
  });

  test('当 gracefulShutdown 不存在时应该降级到 Stop 方法', async () => {
    // 移除 gracefulShutdown 方法
    delete mockServer.gracefulShutdown;

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    try {
      await onSignal('SIGTERM', mockApp, mockServer as KoattyServer, 5000);
    } catch (error: any) {
      if (error.message === 'process.exit called') {
        // 预期的退出
      } else {
        throw error;
      }
    }

    expect(appStopCalled).toBe(true);
    expect(stopCalled).toBe(true);
    expect(mockServer.Stop).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
  });

  test('gracefulShutdown 失败时应该正确处理错误', async () => {
    mockServer.gracefulShutdown = jest.fn().mockRejectedValue(new Error('Shutdown failed'));

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    try {
      await onSignal('SIGTERM', mockApp, mockServer as KoattyServer, 5000);
    } catch (error: any) {
      if (error.message === 'process.exit called') {
        // 预期的退出
      } else {
        throw error;
      }
    }

    expect(appStopCalled).toBe(true);
    expect(mockServer.gracefulShutdown).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1); // 失败时退出码为 1

    mockExit.mockRestore();
  });

  test('超时时应该强制关闭', async () => {
    jest.useFakeTimers();

    mockServer.gracefulShutdown = jest.fn().mockImplementation(() => {
      return new Promise(() => {
        // 永远不 resolve，模拟超时
      });
    });

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const shutdownPromise = onSignal('SIGTERM', mockApp, mockServer as KoattyServer, 1000);

    // 快进到超时
    jest.advanceTimersByTime(1000);

    try {
      await shutdownPromise;
    } catch (error: any) {
      if (error.message === 'process.exit called') {
        // 预期的强制退出
      } else {
        throw error;
      }
    }

    expect(mockExit).toHaveBeenCalledWith(1); // 超时强制退出码为 1

    mockExit.mockRestore();
    jest.useRealTimers();
  });
});

