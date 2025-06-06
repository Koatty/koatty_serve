import { 
  StructuredLogger, 
  ChildLogger, 
  LogContext, 
  PerformanceMetrics,
  createLogger,
  generateTraceId,
  generateConnectionId,
  generateRequestId
} from "../../src/utils/logger";
import { DefaultLogger as Logger } from "koatty_logger";

// Mock koatty_logger
jest.mock("koatty_logger", () => ({
  DefaultLogger: {
    Debug: jest.fn(),
    Info: jest.fn(),
    Warn: jest.fn(),
    Error: jest.fn()
  }
}));

// Mock performance
jest.mock("perf_hooks", () => ({
  performance: {
    now: jest.fn(() => 1000)
  }
}));

describe("StructuredLogger", () => {
  let logger: StructuredLogger;
  let mockDebug: jest.Mock;
  let mockInfo: jest.Mock;
  let mockWarn: jest.Mock;
  let mockError: jest.Mock;

  beforeEach(() => {
    logger = StructuredLogger.getInstance();
    logger.clearGlobalContext();
    
    mockDebug = Logger.Debug as jest.Mock;
    mockInfo = Logger.Info as jest.Mock;
    mockWarn = Logger.Warn as jest.Mock;
    mockError = Logger.Error as jest.Mock;
    
    jest.clearAllMocks();
  });

  describe("Singleton pattern", () => {
    it("should return the same instance", () => {
      const instance1 = StructuredLogger.getInstance();
      const instance2 = StructuredLogger.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("Global context management", () => {
    it("should set and use global context", () => {
      const globalContext: LogContext = {
        module: "TEST",
        serverId: "server-1"
      };
      
      logger.setGlobalContext(globalContext);
      logger.info("Test message");
      
      expect(mockInfo).toHaveBeenCalledWith(
        "[TEST] [Server:server-1] Test message"
      );
    });

    it("should merge global context with local context", () => {
      const globalContext: LogContext = {
        module: "TEST",
        serverId: "server-1"
      };
      
      const localContext: LogContext = {
        connectionId: "conn-123",
        action: "connect"
      };
      
      logger.setGlobalContext(globalContext);
      logger.info("Test message", localContext);
      
      expect(mockInfo).toHaveBeenCalledWith(
        "[TEST] [Server:server-1] [Conn:conn-123] [connect] Test message"
      );
    });

    it("should clear global context", () => {
      const globalContext: LogContext = {
        module: "TEST"
      };
      
      logger.setGlobalContext(globalContext);
      logger.clearGlobalContext();
      logger.info("Test message");
      
      expect(mockInfo).toHaveBeenCalledWith("Test message");
    });

    it("should override global context with local context", () => {
      const globalContext: LogContext = {
        module: "GLOBAL",
        serverId: "server-1"
      };
      
      const localContext: LogContext = {
        module: "LOCAL",
        connectionId: "conn-123"
      };
      
      logger.setGlobalContext(globalContext);
      logger.info("Test message", localContext);
      
      expect(mockInfo).toHaveBeenCalledWith(
        "[LOCAL] [Server:server-1] [Conn:conn-123] Test message"
      );
    });
  });

  describe("Message formatting", () => {
    it("should format message with module prefix", () => {
      logger.info("Test message", { module: "HTTP" });
      expect(mockInfo).toHaveBeenCalledWith("[HTTP] Test message");
    });

    it("should format message with protocol prefix", () => {
      logger.info("Test message", { protocol: "https" });
      expect(mockInfo).toHaveBeenCalledWith("[HTTPS] Test message");
    });

    it("should format message with multiple prefixes", () => {
      const context: LogContext = {
        module: "HTTP",
        protocol: "https",
        serverId: "srv-1",
        connectionId: "conn-123",
        action: "request"
      };
      
      logger.info("Test message", context);
      expect(mockInfo).toHaveBeenCalledWith(
        "[HTTP] [HTTPS] [Server:srv-1] [Conn:conn-123] [request] Test message"
      );
    });

    it("should include data in message", () => {
      const data = { userId: 123, path: "/api/test" };
      logger.info("Request processed", { module: "HTTP" }, data);
      
      expect(mockInfo).toHaveBeenCalledWith(
        '[HTTP] Request processed | Data: {"userId":123,"path":"/api/test"}'
      );
    });

    it("should include trace ID in message", () => {
      logger.info("Test message", { 
        module: "HTTP",
        traceId: "trace-123" 
      });
      
      expect(mockInfo).toHaveBeenCalledWith(
        "[HTTP] Test message | TraceId: trace-123"
      );
    });

    it("should format message with data and trace ID", () => {
      logger.info("Test message", 
        { module: "HTTP", traceId: "trace-123" }, 
        { key: "value" }
      );
      
      expect(mockInfo).toHaveBeenCalledWith(
        '[HTTP] Test message | Data: {"key":"value"} | TraceId: trace-123'
      );
    });

    it("should handle non-object data", () => {
      logger.info("Test message", { module: "HTTP" }, "string data");
      expect(mockInfo).toHaveBeenCalledWith(
        "[HTTP] Test message | Data: string data"
      );
    });
  });

  describe("Log levels", () => {
    it("should log debug messages", () => {
      logger.debug("Debug message", { module: "TEST" });
      expect(mockDebug).toHaveBeenCalledWith("[TEST] Debug message");
    });

    it("should log info messages", () => {
      logger.info("Info message", { module: "TEST" });
      expect(mockInfo).toHaveBeenCalledWith("[TEST] Info message");
    });

    it("should log warning messages", () => {
      logger.warn("Warning message", { module: "TEST" });
      expect(mockWarn).toHaveBeenCalledWith("[TEST] Warning message");
    });

    it("should log error messages with Error object", () => {
      const error = new Error("Test error");
      error.stack = "Error stack trace";
      
      logger.error("Error occurred", { module: "TEST" }, error);
      
      expect(mockError).toHaveBeenCalledWith(
        '[TEST] Error occurred | Data: {"name":"Error","message":"Test error","stack":"Error stack trace"}'
      );
    });

    it("should log error messages with non-Error object", () => {
      const errorData = { code: 500, message: "Internal error" };
      
      logger.error("Error occurred", { module: "TEST" }, errorData);
      
      expect(mockError).toHaveBeenCalledWith(
        '[TEST] Error occurred | Data: {"code":500,"message":"Internal error"}'
      );
    });
  });

     describe("Performance tracking", () => {
     it("should start performance tracking", () => {
       const mockPerformance = require("perf_hooks").performance;
       mockPerformance.now.mockReturnValue(1000);
       
       // Mock memory usage
       const originalMemoryUsage = process.memoryUsage;
       (process as any).memoryUsage = jest.fn().mockReturnValue({
         rss: 100000000,
         heapUsed: 1000000,
         heapTotal: 2000000,
         external: 100000,
         arrayBuffers: 50000
       });

       logger.startPerformanceTracking("test-track", { module: "PERF" });
       
       expect(mockDebug).toHaveBeenCalledWith(
         '[PERF] [perf_start] Performance tracking started | Data: {"trackingId":"test-track"}'
       );

       // Restore original
       process.memoryUsage = originalMemoryUsage;
     });

     it("should end performance tracking and return metrics", () => {
       const mockPerformance = require("perf_hooks").performance;
       mockPerformance.now.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
       
       // Mock memory usage
       const originalMemoryUsage = process.memoryUsage;
       (process as any).memoryUsage = jest.fn()
         .mockReturnValueOnce({
           rss: 100000000,
           heapUsed: 1000000,
           heapTotal: 2000000,
           external: 100000,
           arrayBuffers: 50000
         })
         .mockReturnValueOnce({
           rss: 101000000,
           heapUsed: 1100000,
           heapTotal: 2100000,
           external: 110000,
           arrayBuffers: 55000
         });

       logger.startPerformanceTracking("test-track", { module: "PERF" });
       const metrics = logger.endPerformanceTracking("test-track", { module: "PERF" });
       
       expect(metrics).toBeDefined();
       expect(metrics?.duration).toBe(1000); // 2000 - 1000
       expect(mockInfo).toHaveBeenCalledWith(
         expect.stringContaining('[PERF] [perf_end] Performance tracking completed')
       );

       // Restore original
       process.memoryUsage = originalMemoryUsage;
     });

     it("should handle missing tracking ID", () => {
       const metrics = logger.endPerformanceTracking("missing-track", { module: "PERF" });
       
       expect(metrics).toBeNull();
       expect(mockWarn).toHaveBeenCalledWith(
         '[PERF] Performance tracking not found | Data: {"trackingId":"missing-track"}'
       );
     });
   });

     describe("Server events", () => {
     it("should log server starting event", () => {
       logger.logServerEvent("starting", { module: "HTTP" }, { port: 3000 });
       
       expect(mockInfo).toHaveBeenCalledWith(
         '[HTTP] [server_starting] Server starting | Data: {"port":3000}'
       );
     });

     it("should log server error event", () => {
       logger.logServerEvent("error", { module: "HTTP" }, { error: "Failed to bind" });
       
       expect(mockError).toHaveBeenCalledWith(
         '[HTTP] [server_error] Server error occurred | Data: {"error":"Failed to bind"}'
       );
     });

     it("should log all server event types", () => {
       const events: Array<'starting' | 'started' | 'stopping' | 'stopped' | 'error'> = 
         ['starting', 'started', 'stopping', 'stopped', 'error'];
       
       events.forEach(event => {
         logger.logServerEvent(event, { module: "TEST" });
         
         if (event === 'error') {
           expect(mockError).toHaveBeenCalled();
         } else {
           expect(mockInfo).toHaveBeenCalled();
         }
       });
     });
   });

  describe("Connection events", () => {
    it("should log connection events", () => {
      const events: Array<'connected' | 'disconnected' | 'error' | 'timeout'> = 
        ['connected', 'disconnected', 'error', 'timeout'];
      
      events.forEach(event => {
        logger.logConnectionEvent(event, { 
          module: "WS", 
          connectionId: "conn-123" 
        });
        
        if (event === 'error') {
          expect(mockError).toHaveBeenCalled();
        } else {
          expect(mockInfo).toHaveBeenCalled();
        }
      });
    });
  });

  describe("Security events", () => {
    it("should log security events", () => {
      const events: Array<'auth_success' | 'auth_failure' | 'rate_limit' | 'blocked'> = 
        ['auth_success', 'auth_failure', 'rate_limit', 'blocked'];
      
      events.forEach(event => {
        logger.logSecurityEvent(event, { 
          module: "AUTH", 
          userId: "user-123" 
        });
        
        if (['auth_failure', 'rate_limit', 'blocked'].includes(event)) {
          expect(mockWarn).toHaveBeenCalled();
        } else {
          expect(mockInfo).toHaveBeenCalled();
        }
      });
    });
  });

  describe("Child logger creation", () => {
    it("should create child logger with context", () => {
      const childContext: LogContext = {
        module: "CHILD",
        connectionId: "conn-456"
      };
      
      const childLogger = logger.createChildLogger(childContext);
      expect(childLogger).toBeInstanceOf(ChildLogger);
    });
  });
});

describe("ChildLogger", () => {
  let parentLogger: StructuredLogger;
  let childLogger: ChildLogger;
  let mockInfo: jest.Mock;

  beforeEach(() => {
    parentLogger = StructuredLogger.getInstance();
    parentLogger.clearGlobalContext();
    
    const childContext: LogContext = {
      module: "CHILD",
      connectionId: "conn-789"
    };
    
    childLogger = parentLogger.createChildLogger(childContext);
    mockInfo = Logger.Info as jest.Mock;
    jest.clearAllMocks();
  });

  it("should inherit parent context and add child context", () => {
    parentLogger.setGlobalContext({ serverId: "srv-1" });
    
    childLogger.info("Child message", { action: "test" });
    
    expect(mockInfo).toHaveBeenCalledWith(
      "[CHILD] [Server:srv-1] [Conn:conn-789] [test] Child message"
    );
  });

  it("should delegate all log methods to parent", () => {
    const parentDebugSpy = jest.spyOn(parentLogger, "debug");
    const parentInfoSpy = jest.spyOn(parentLogger, "info");
    const parentWarnSpy = jest.spyOn(parentLogger, "warn");
    const parentErrorSpy = jest.spyOn(parentLogger, "error");

    childLogger.debug("Debug message");
    childLogger.info("Info message");
    childLogger.warn("Warn message");
    childLogger.error("Error message");

    expect(parentDebugSpy).toHaveBeenCalled();
    expect(parentInfoSpy).toHaveBeenCalled();
    expect(parentWarnSpy).toHaveBeenCalled();
    expect(parentErrorSpy).toHaveBeenCalled();
  });

  it("should delegate event logging methods", () => {
    const parentServerEventSpy = jest.spyOn(parentLogger, "logServerEvent");
    const parentConnectionEventSpy = jest.spyOn(parentLogger, "logConnectionEvent");
    const parentSecurityEventSpy = jest.spyOn(parentLogger, "logSecurityEvent");

    childLogger.logServerEvent("started");
    childLogger.logConnectionEvent("connected");
    childLogger.logSecurityEvent("auth_success");

    expect(parentServerEventSpy).toHaveBeenCalled();
    expect(parentConnectionEventSpy).toHaveBeenCalled();
    expect(parentSecurityEventSpy).toHaveBeenCalled();
  });

     it("should delegate performance tracking methods", () => {
     // Mock performance and memory for child logger test
     const mockPerformance = require("perf_hooks").performance;
     mockPerformance.now.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
     
     const originalMemoryUsage = process.memoryUsage;
     (process as any).memoryUsage = jest.fn()
       .mockReturnValueOnce({
         rss: 100000000,
         heapUsed: 1000000,
         heapTotal: 2000000,
         external: 100000,
         arrayBuffers: 50000
       })
       .mockReturnValueOnce({
         rss: 101000000,
         heapUsed: 1100000,
         heapTotal: 2100000,
         external: 110000,
         arrayBuffers: 55000
       });

     const parentStartPerfSpy = jest.spyOn(parentLogger, "startPerformanceTracking");
     const parentEndPerfSpy = jest.spyOn(parentLogger, "endPerformanceTracking");

     childLogger.startPerformanceTracking("test-track");
     childLogger.endPerformanceTracking("test-track");

     expect(parentStartPerfSpy).toHaveBeenCalled();
     expect(parentEndPerfSpy).toHaveBeenCalled();

     // Restore original
     process.memoryUsage = originalMemoryUsage;
   });
});

describe("Utility functions", () => {
  describe("createLogger", () => {
    it("should create child logger with context", () => {
      const context: LogContext = {
        module: "UTIL",
        protocol: "http"
      };
      
      const logger = createLogger(context);
      expect(logger).toBeInstanceOf(ChildLogger);
    });
  });

  describe("ID generators", () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(1234567890);
      jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should generate trace ID", () => {
      const traceId = generateTraceId();
      expect(traceId).toMatch(/^trace_\d+_[a-z0-9]+$/);
      expect(traceId).toContain("1234567890");
    });

    it("should generate connection ID", () => {
      const connectionId = generateConnectionId();
      expect(connectionId).toMatch(/^conn_\d+_[a-z0-9]+$/);
      expect(connectionId).toContain("1234567890");
    });

    it("should generate request ID", () => {
      const requestId = generateRequestId();
      expect(requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(requestId).toContain("1234567890");
    });

    it("should generate unique IDs", () => {
      // Reset mocks to return different values
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(2000)
        .mockReturnValueOnce(3000);
      
      jest.spyOn(Math, 'random')
        .mockReturnValueOnce(0.1)
        .mockReturnValueOnce(0.2)
        .mockReturnValueOnce(0.3);

      const id1 = generateTraceId();
      const id2 = generateTraceId();
      const id3 = generateTraceId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });
});

describe("Integration tests", () => {
  let logger: StructuredLogger;

  beforeEach(() => {
    logger = StructuredLogger.getInstance();
    logger.clearGlobalContext();
    jest.clearAllMocks();
  });

     it("should work in realistic server scenario", () => {
     // Mock performance and memory
     const mockPerformance = require("perf_hooks").performance;
     mockPerformance.now.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
     
     const originalMemoryUsage = process.memoryUsage;
     (process as any).memoryUsage = jest.fn()
       .mockReturnValueOnce({
         rss: 100000000,
         heapUsed: 1000000,
         heapTotal: 2000000,
         external: 100000,
         arrayBuffers: 50000
       })
       .mockReturnValueOnce({
         rss: 101000000,
         heapUsed: 1100000,
         heapTotal: 2100000,
         external: 110000,
         arrayBuffers: 55000
       });

     // Set global server context
     logger.setGlobalContext({
       module: "HTTP",
       serverId: "srv-001"
     });

     // Create child logger for connection
     const connLogger = logger.createChildLogger({
       connectionId: "conn-123",
       traceId: "trace-456"
     });

     // Start performance tracking
     connLogger.startPerformanceTracking("request-789");

     // Log request processing
     connLogger.info("Processing request", { action: "request" }, {
       method: "GET",
       path: "/api/users",
       userAgent: "test-client"
     });

     // Log success
     connLogger.info("Request completed", { action: "response" }, {
       statusCode: 200,
       responseTime: "45ms"
     });

     // End performance tracking
     connLogger.endPerformanceTracking("request-789");

     // Verify logs were called with expected format
     expect(Logger.Debug).toHaveBeenCalled();
     expect(Logger.Info).toHaveBeenCalledTimes(3);

     // Restore original
     process.memoryUsage = originalMemoryUsage;
   });

  it("should handle error scenarios", () => {
    const logger = createLogger({ module: "ERROR_TEST" });
    
    // Simulate error
    const error = new Error("Database connection failed");
    logger.error("Failed to process request", { action: "db_query" }, error);

    // Simulate security event
    logger.logSecurityEvent("auth_failure", { userId: "user-123" }, {
      reason: "Invalid credentials",
      ip: "192.168.1.100"
    });

    expect(Logger.Error).toHaveBeenCalledTimes(1);
    expect(Logger.Warn).toHaveBeenCalledTimes(1);
  });
}); 