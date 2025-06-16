import { GracefulShutdownManager, ShutdownStepFactory, ShutdownStatus, ShutdownStep } from "../../src/utils/graceful-shutdown";

describe("GracefulShutdownManager", () => {
  let shutdownManager: GracefulShutdownManager;

  beforeEach(() => {
    shutdownManager = new GracefulShutdownManager("test");
  });

  afterEach(() => {
    // 确保每个测试后重置状态
    jest.clearAllTimers();
  });

  describe("基本功能", () => {
    it("应该正确初始化", () => {
      expect(shutdownManager.isInShutdown()).toBe(false);
      expect(shutdownManager.getStatus()).toBe(ShutdownStatus.NOT_STARTED);
    });

    it("应该防止重复关闭", async () => {
      const steps: ShutdownStep[] = [
        ShutdownStepFactory.createStopAcceptingStep(
          async () => { await new Promise(resolve => setTimeout(resolve, 100)); },
          1000
        )
      ];

      // 启动第一个关闭流程
      const firstShutdown = shutdownManager.performGracefulShutdown(steps, {
        timeout: 2000,
        drainDelay: 100
      });
      
      // 尝试启动第二个关闭流程
      await expect(shutdownManager.performGracefulShutdown(steps))
        .rejects.toThrow('Graceful shutdown already in progress');

      await firstShutdown;
    }, 10000);
  });

  describe("关闭步骤执行", () => {
    it("应该成功执行所有步骤", async () => {
      const executedSteps: string[] = [];
      
      const steps: ShutdownStep[] = [
        {
          name: "step1",
          description: "Test step 1",
          execute: async () => { executedSteps.push("step1"); },
          isRequired: true
        },
        {
          name: "step2", 
          description: "Test step 2",
          execute: async () => { executedSteps.push("step2"); },
          isRequired: true
        }
      ];

      const result = await shutdownManager.performGracefulShutdown(steps, {
        timeout: 5000,
        drainDelay: 100
      });

      expect(result.status).toBe(ShutdownStatus.COMPLETED);
      expect(result.completedSteps).toEqual(["step1", "step2"]);
      expect(result.failedSteps).toHaveLength(0);
      expect(executedSteps).toEqual(["step1", "step2"]);
      expect(result.totalTime).toBeGreaterThan(0);
    });

    it("应该处理步骤失败", async () => {
      const steps: ShutdownStep[] = [
        {
          name: "success_step",
          description: "Successful step",
          execute: async () => { /* 成功 */ },
          isRequired: true
        },
        {
          name: "failing_step",
          description: "Failing step", 
          execute: async () => { throw new Error("Step failed"); },
          isRequired: true
        }
      ];

      const result = await shutdownManager.performGracefulShutdown(steps, {
        timeout: 5000,
        drainDelay: 0
      });

      expect(result.status).toBe(ShutdownStatus.FAILED);
      expect(result.completedSteps).toEqual(["success_step"]);
      // 可能有多个失败步骤（包括全局失败）
      expect(result.failedSteps.length).toBeGreaterThanOrEqual(1);
      expect(result.failedSteps.some(f => f.step === "failing_step")).toBe(true);
      expect(result.failedSteps.some(f => f.error === "Step failed")).toBe(true);
    });

    it("应该跳过非必需的失败步骤", async () => {
      const steps: ShutdownStep[] = [
        {
          name: "required_step",
          description: "Required step",
          execute: async () => { /* 成功 */ },
          isRequired: true
        },
        {
          name: "optional_step",
          description: "Optional step",
          execute: async () => { throw new Error("Optional step failed"); },
          isRequired: false
        },
        {
          name: "final_step", 
          description: "Final step",
          execute: async () => { /* 成功 */ },
          isRequired: true
        }
      ];

      const result = await shutdownManager.performGracefulShutdown(steps, {
        timeout: 5000,
        drainDelay: 100
      });

      expect(result.status).toBe(ShutdownStatus.COMPLETED);
      expect(result.completedSteps).toEqual(["required_step", "final_step"]);
      expect(result.failedSteps).toHaveLength(1);
      expect(result.failedSteps[0].step).toBe("optional_step");
    }, 10000);
  });

  describe("超时处理", () => {
    it("应该处理全局超时", async () => {
      const steps: ShutdownStep[] = [
        {
          name: "slow_step",
          description: "Slow step",
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
          },
          isRequired: true
        }
      ];

      const result = await shutdownManager.performGracefulShutdown(steps, {
        timeout: 500, // 短超时
        drainDelay: 0
      });

      expect(result.status).toBe(ShutdownStatus.FAILED);
      expect(result.failedSteps.length).toBeGreaterThanOrEqual(1);
      expect(result.failedSteps.some(f => f.error.includes("Global timeout"))).toBe(true);
    });

    it("应该处理步骤级超时", async () => {
      const steps: ShutdownStep[] = [
        {
          name: "timeout_step",
          description: "Step with timeout",
          timeout: 200,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
          },
          isRequired: true
        }
      ];

      const result = await shutdownManager.performGracefulShutdown(steps, {
        timeout: 5000,
        drainDelay: 0
      });

      expect(result.status).toBe(ShutdownStatus.FAILED);
      expect(result.failedSteps.length).toBeGreaterThanOrEqual(1);
      expect(result.failedSteps.some(f => f.error.includes("timed out"))).toBe(true);
    });
  });

  describe("排空延迟", () => {
    it("应该等待排空延迟", async () => {
      const startTime = Date.now();
      const drainDelay = 300;
      
      const steps: ShutdownStep[] = [
        {
          name: "quick_step",
          description: "Quick step",
          execute: async () => { /* 快速完成 */ },
          isRequired: true
        }
      ];

      const result = await shutdownManager.performGracefulShutdown(steps, {
        drainDelay
      });

      const elapsed = Date.now() - startTime;
      
      expect(result.status).toBe(ShutdownStatus.COMPLETED);
      expect(elapsed).toBeGreaterThanOrEqual(drainDelay - 50); // 允许一些时间误差
    });
  });
});

describe("ShutdownStepFactory", () => {
  describe("createStopAcceptingStep", () => {
    it("应该创建停止接受连接步骤", () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const step = ShutdownStepFactory.createStopAcceptingStep(mockFn, 3000);

      expect(step.name).toBe("stop_accepting_connections");
      expect(step.description).toBe("Stop accepting new connections");
      expect(step.timeout).toBe(3000);
      expect(step.isRequired).toBe(true);
    });
  });

  describe("createWaitConnectionsStep", () => {
    it("应该创建等待连接完成步骤", () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const step = ShutdownStepFactory.createWaitConnectionsStep(mockFn, 10000);

      expect(step.name).toBe("wait_connections_completion");
      expect(step.description).toBe("Wait for existing connections to complete");
      expect(step.timeout).toBe(10000);
      expect(step.isRequired).toBe(true);
      expect(step.retryCount).toBe(1);
    });
  });

  describe("createForceCloseStep", () => {
    it("应该创建强制关闭步骤", () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const step = ShutdownStepFactory.createForceCloseStep(mockFn, 2000);

      expect(step.name).toBe("force_close_connections");
      expect(step.description).toBe("Force close remaining connections");
      expect(step.timeout).toBe(2000);
      expect(step.isRequired).toBe(true);
    });
  });

  describe("createStopMonitoringStep", () => {
    it("应该创建停止监控步骤", () => {
      const mockFn = jest.fn();
      const step = ShutdownStepFactory.createStopMonitoringStep(mockFn, 1000);

      expect(step.name).toBe("stop_monitoring_cleanup");
      expect(step.description).toBe("Stop monitoring and cleanup resources");
      expect(step.timeout).toBe(1000);
      expect(step.isRequired).toBe(false);
    });
  });

  describe("createProtocolShutdownStep", () => {
    it("应该创建协议特定关闭步骤", () => {
      const mockFn = jest.fn();
      const step = ShutdownStepFactory.createProtocolShutdownStep(mockFn, "http", 2500);

      expect(step.name).toBe("http_force_shutdown");
      expect(step.description).toBe("Force shutdown http specific resources");
      expect(step.timeout).toBe(2500);
      expect(step.isRequired).toBe(true);
    });
  });
});

describe("集成测试", () => {
  it("应该与 BaseServer 集成工作", async () => {
    const shutdownManager = new GracefulShutdownManager("http");
    
    // 模拟 BaseServer 的关闭步骤
    const steps = [
      ShutdownStepFactory.createStopAcceptingStep(
        async () => { /* 停止接受新连接 */ },
        5000
      ),
      ShutdownStepFactory.createWaitConnectionsStep(
        async () => { /* 等待连接完成 */ },
        15000
      ),
      ShutdownStepFactory.createForceCloseStep(
        async () => { /* 强制关闭连接 */ },
        5000
      ),
      ShutdownStepFactory.createStopMonitoringStep(
        () => { /* 停止监控 */ },
        3000
      )
    ];

    const result = await shutdownManager.performGracefulShutdown(steps, {
      timeout: 30000,
      drainDelay: 1000
    });

    expect(result.status).toBe(ShutdownStatus.COMPLETED);
    expect(result.completedSteps).toHaveLength(4);
    expect(result.failedSteps).toHaveLength(0);
    expect(result.totalTime).toBeGreaterThanOrEqual(1000); // 至少包含 drainDelay
  });
}); 