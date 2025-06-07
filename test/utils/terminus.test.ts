import EventEmitter from "events";
import { KoattyServer, KoattyApplication } from "koatty_core";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import { CreateTerminus, BindProcessEvent, onSignal } from "../../src/utils/terminus";

// Simple mock for KoattyApplication
class MockKoattyApplication extends EventEmitter {
  env: string = "test";
  name: string = "test-app";
  version: string = "1.0.0";
  router: any = {};
  options: any = {};
  server: any = {};
  appPath: string = "/test";
  rootPath: string = "/test";

  config(key?: string, defaultValue?: any) {
    return defaultValue;
  }
}

// Mock KoattyServer with full interface implementation
class MockKoattyServer implements KoattyServer {
  status: number = 200;
  options: any = {};
  server: any = {};
  
  Start(listenCallback?: () => void): any {
    if (listenCallback) {
      listenCallback();
    }
    return {
      close: (cb?: () => void) => cb && cb()
    };
  }
  
  Stop(callback?: () => void): void {
    if (callback) {
      callback();
    }
  }
}

describe("Terminus", () => {
  let mockServer: MockKoattyServer;
  let mockApp: MockKoattyApplication;
  let processExitSpy: jest.SpyInstance;
  let processOnSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockServer = new MockKoattyServer();
    mockApp = new MockKoattyApplication();
    
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
      return undefined as never;
    });
    processOnSpy = jest.spyOn(process, 'on');
    loggerWarnSpy = jest.spyOn(Logger, 'Warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger, 'Error').mockImplementation();

    process.removeAllListeners();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
    jest.useRealTimers();
    mockApp.removeAllListeners();
    process.removeAllListeners();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("CreateTerminus", () => {
    it("should create terminus with default options", () => {
      CreateTerminus(mockApp as KoattyApplication, mockServer);
      expect(processOnSpy).toHaveBeenCalledTimes(3); // SIGINT, SIGTERM, SIGQUIT
    });

    it("should create terminus with custom signals", () => {
      CreateTerminus(mockApp as KoattyApplication, mockServer, {
        timeout: 1000,
        signals: ["SIGUSR2"]
      });
      expect(processOnSpy).toHaveBeenCalledTimes(1);
      expect(processOnSpy).toHaveBeenCalledWith("SIGUSR2", expect.any(Function));
    });
  });

  describe("BindProcessEvent", () => {
    it("should bind event listeners to process", () => {
      const mockListener = jest.fn();
      mockApp.on("test", mockListener);

      BindProcessEvent(mockApp, "test", "beforeExit");
      
      const listeners = process.listeners("beforeExit");
      expect(listeners).toContain(mockListener);
      expect(mockApp.listeners("test")).toHaveLength(0);
    });

    it("should bind multiple listeners", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      mockApp.on("test", listener1);
      mockApp.on("test", listener2);

      BindProcessEvent(mockApp, "test", "beforeExit");
      
      const listeners = process.listeners("beforeExit");
      expect(listeners).toContain(listener1);
      expect(listeners).toContain(listener2);
    });
  });

  describe("onSignal", () => {
    it("should handle signal in development environment", async () => {
      process.env.NODE_ENV = "development";
      
      await onSignal("SIGTERM", mockApp as KoattyApplication, mockServer, 1000);
      
      expect(mockServer.status).toBe(503);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Received kill signal (SIGTERM), shutting down..."
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it("should handle signal in production environment", async () => {
      process.env.NODE_ENV = "production";
      
      const stopSpy = jest.spyOn(mockServer, "Stop");
      await onSignal("SIGTERM", mockApp as KoattyApplication, mockServer, 1000);
      
      expect(mockServer.status).toBe(503);
      expect(stopSpy).toHaveBeenCalled();
    });

    it("should force shutdown after timeout", async () => {
      process.env.NODE_ENV = "production";
      
      // Mock server.Stop to never call callback and delay execution
      const mockServerNoCallback = {
        ...mockServer,
        Stop: (callback?: () => void) => {
          return new Promise((resolve) => {
            setTimeout(resolve, 2000); // Longer than our timeout
          });
        },
        Start: mockServer.Start
      };
      
      const signalPromise = onSignal("SIGTERM", mockApp as KoattyApplication, mockServerNoCallback as KoattyServer, 1000);
      
      // Fast-forward past the timeout
      await jest.advanceTimersByTimeAsync(1500);
      
      await signalPromise;
      
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Received kill signal (SIGTERM), shutting down..."
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Could not close connections in time, forcefully shutting down"
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle beforeExit events", async () => {
      const beforeExitListener = jest.fn();
      process.on("beforeExit", beforeExitListener);
      
      await onSignal("SIGTERM", mockApp as KoattyApplication, mockServer, 1000);
      
      expect(beforeExitListener).toHaveBeenCalled();
    });

    it("should handle failing beforeExit events", async () => {
      const beforeExitListener = jest.fn().mockImplementation(() => {
        throw new Error("Test error");
      });
      process.on("beforeExit", beforeExitListener);
      
      await expect(onSignal("SIGTERM", mockApp as KoattyApplication, mockServer, 1000))
        .rejects.toThrow("Test error");
      
      expect(beforeExitListener).toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should handle server.Stop throwing an error", async () => {
      process.env.NODE_ENV = "production";
      
      const mockServerWithError = {
        ...mockServer,
        Stop: () => {
          throw new Error("Stop error");
        },
        Start: mockServer.Start
      };
      
      await expect(onSignal("SIGTERM", mockApp as KoattyApplication, mockServerWithError as KoattyServer, 1000))
        .rejects.toThrow("Stop error");
    });

    it("should handle multiple signals", async () => {
      const signals = ["SIGINT", "SIGTERM", "SIGQUIT"];
      CreateTerminus(mockApp as KoattyApplication, mockServer, {
        timeout: 1000,
        signals
      });

      loggerWarnSpy.mockClear();

      process.emit("SIGTERM");

      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      expect(loggerWarnSpy).toHaveBeenCalledWith("Received kill signal (SIGTERM), shutting down...");
    });
  });
});
