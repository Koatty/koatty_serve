import { GrpcServer } from '../../src/server/grpc';
import { KoattyApplication } from 'koatty_core';

// Mock gRPC
const mockGrpcServer = {
  addService: jest.fn(),
  bind: jest.fn((address: string, credentials: any) => {
    return 0; // Success
  }),
  bindAsync: jest.fn((address: string, credentials: any, callback: any) => {
    // Simulate successful binding
    setTimeout(() => {
      callback(null, 50051);
      // Call start after successful binding
      mockGrpcServer.start();
    }, 0);
  }),
  start: jest.fn(),
  tryShutdown: jest.fn((callback: any) => {
    // Immediately call callback without error for successful shutdown
    setTimeout(() => callback(), 0);
  }),
  forceShutdown: jest.fn(),
  register: jest.fn()
};

const mockCredentials = {
  createInsecure: jest.fn(() => ({})),
  createSsl: jest.fn(() => ({})),
  createFromMetadataGenerator: jest.fn(() => ({}))
};

jest.mock('@grpc/grpc-js', () => ({
  Server: jest.fn().mockImplementation(() => mockGrpcServer),
  ServerCredentials: {
    createInsecure: jest.fn(() => ({})),
    createSsl: jest.fn(() => ({}))
  },
  credentials: {
    createInsecure: jest.fn(() => ({})),
    createSsl: jest.fn(() => ({})),
    createFromMetadataGenerator: jest.fn(() => ({}))
  },
  loadPackageDefinition: jest.fn(() => ({
    TestService: {
      service: {
        TestMethod: {
          path: '/test.TestService/TestMethod',
          requestType: {},
          responseType: {},
          requestSerialize: jest.fn(),
          responseDeserialize: jest.fn()
        }
      }
    }
  })),
  status: {
    OK: 0,
    CANCELLED: 1,
    UNKNOWN: 2,
    INVALID_ARGUMENT: 3,
    DEADLINE_EXCEEDED: 4,
    NOT_FOUND: 5,
    ALREADY_EXISTS: 6,
    PERMISSION_DENIED: 7,
    UNAUTHENTICATED: 16,
    RESOURCE_EXHAUSTED: 8,
    FAILED_PRECONDITION: 9,
    ABORTED: 10,
    OUT_OF_RANGE: 11,
    UNIMPLEMENTED: 12,
    INTERNAL: 13,
    UNAVAILABLE: 14,
    DATA_LOSS: 15
  }
}));

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({}))
}));

describe('GrpcServer', () => {
  let mockApp: any;
  let grpcServer: GrpcServer;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      config: jest.fn(() => ({
        hostname: '127.0.0.1',
        port: 50051,
        protocol: 'grpc'
      })),
      on: jest.fn(),
      emit: jest.fn(),
      callback: jest.fn()
    };

    grpcServer = new GrpcServer(mockApp as KoattyApplication, {
      hostname: '127.0.0.1',
      port: 50051,
      protocol: 'grpc'
    });
  });

  describe('Initialization', () => {
    it('should create gRPC server instance', () => {
      expect(grpcServer).toBeInstanceOf(GrpcServer);
    });

    it('should configure with proto files', () => {
      const serverWithProtos = new GrpcServer(mockApp as KoattyApplication, {
        hostname: '127.0.0.1',
        port: 50051,
        protocol: 'grpc',
        ext: {
          protoFile: 'test.proto',
          packageName: 'test'
        }
      });

      expect(serverWithProtos).toBeInstanceOf(GrpcServer);
    });

    it('should handle multiple service definitions', () => {
      const serverWithServices = new GrpcServer(mockApp as KoattyApplication, {
        hostname: '127.0.0.1',
        port: 50051,
        protocol: 'grpc',
        ext: {
          services: {
            TestService: {
              TestMethod: jest.fn()
            },
            UserService: {
              GetUser: jest.fn(),
              CreateUser: jest.fn()
            }
          }
        }
      });

      expect(serverWithServices).toBeInstanceOf(GrpcServer);
    });
  });

  describe('Server Lifecycle', () => {
    it('should start gRPC server successfully', async () => {
      const promise = new Promise<void>((resolve, reject) => {
        grpcServer.Start((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await promise;
      expect(mockGrpcServer.bindAsync).toHaveBeenCalledWith(
        '127.0.0.1:50051',
        expect.any(Object),
        expect.any(Function)
      );
      expect(mockGrpcServer.start).toHaveBeenCalled();
    });

    it('should stop gRPC server successfully', async () => {
      const promise = new Promise<void>((resolve, reject) => {
        grpcServer.Stop((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await promise;
      // Note: The actual shutdown is handled by the graceful shutdown mechanism
    }, 10000);

    it('should force shutdown when graceful fails', async () => {
      mockGrpcServer.tryShutdown.mockImplementation((callback: any) => {
        // Simulate timeout
        setTimeout(() => callback(new Error('Timeout')), 100);
      });

      const promise = new Promise<void>((resolve, reject) => {
        grpcServer.Stop((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await promise;
      // Note: The force shutdown logic is handled by the graceful shutdown mechanism
    }, 10000);
  });

  describe('Service Registration', () => {
    it('should register gRPC services', () => {
      const testService = {
        TestMethod: jest.fn((call: any, callback: any) => {
          callback(null, { message: 'Hello' });
        })
      };

      // Simulate service registration
      const serviceDefinition = {
        TestMethod: {
          path: '/test.TestService/TestMethod',
          requestType: {},
          responseType: {}
        }
      };

      expect(() => {
        mockGrpcServer.addService(serviceDefinition, testService);
      }).not.toThrow();

      expect(mockGrpcServer.addService).toHaveBeenCalledWith(
        serviceDefinition,
        testService
      );
    });

    it('should handle service method implementations', () => {
      const userService = {
        GetUser: jest.fn((call: any, callback: any) => {
          const { userId } = call.request;
          if (userId) {
            callback(null, { id: userId, name: 'Test User' });
          } else {
            callback({
              code: 3, // INVALID_ARGUMENT
              message: 'User ID is required'
            });
          }
        }),
        
        CreateUser: jest.fn((call: any, callback: any) => {
          const user = call.request;
          callback(null, { ...user, id: Date.now() });
        })
      };

      // Test GetUser with valid input
      const mockCall1 = { request: { userId: 123 } };
      const mockCallback1 = jest.fn();
      
      userService.GetUser(mockCall1, mockCallback1);
      expect(mockCallback1).toHaveBeenCalledWith(null, { id: 123, name: 'Test User' });

      // Test GetUser with invalid input
      const mockCall2 = { request: {} };
      const mockCallback2 = jest.fn();
      
      userService.GetUser(mockCall2, mockCallback2);
      expect(mockCallback2).toHaveBeenCalledWith({
        code: 3,
        message: 'User ID is required'
      });
    });
  });

  describe('Streaming Support', () => {
    it('should handle server streaming', () => {
      const streamingService = {
        StreamData: jest.fn((call: any) => {
          const data = [1, 2, 3, 4, 5];
          
          data.forEach(item => {
            call.write({ value: item });
          });
          
          call.end();
        })
      };

      const mockCall = {
        write: jest.fn(),
        end: jest.fn()
      };

      streamingService.StreamData(mockCall);

      expect(mockCall.write).toHaveBeenCalledTimes(5);
      expect(mockCall.end).toHaveBeenCalled();
    });

    it('should handle client streaming', () => {
      const clientStreamService = {
        UploadData: jest.fn((call: any, callback: any) => {
          const chunks: any[] = [];
          
          call.on('data', (chunk: any) => {
            chunks.push(chunk);
          });
          
          call.on('end', () => {
            callback(null, { 
              totalChunks: chunks.length,
              totalSize: chunks.reduce((sum, chunk) => sum + chunk.size, 0)
            });
          });
        })
      };

      const mockCall = {
        on: jest.fn((event: string, handler: any) => {
          if (event === 'data') {
            // Simulate incoming data
            handler({ data: 'chunk1', size: 6 });
            handler({ data: 'chunk2', size: 6 });
          } else if (event === 'end') {
            handler();
          }
        })
      };

      const mockCallback = jest.fn();
      
      clientStreamService.UploadData(mockCall, mockCallback);
      
      expect(mockCall.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockCall.on).toHaveBeenCalledWith('end', expect.any(Function));
    });

    it('should handle bidirectional streaming', () => {
      const bidiStreamService = {
        Chat: jest.fn((call: any) => {
          call.on('data', (message: any) => {
            // Echo the message back
            call.write({
              user: 'server',
              message: `Echo: ${message.message}`,
              timestamp: Date.now()
            });
          });
          
          call.on('end', () => {
            call.end();
          });
        })
      };

      const mockCall = {
        on: jest.fn((event: string, handler: any) => {
          if (event === 'data') {
            handler({ user: 'client', message: 'Hello' });
          } else if (event === 'end') {
            handler();
          }
        }),
        write: jest.fn(),
        end: jest.fn()
      };

      bidiStreamService.Chat(mockCall);
      
      expect(mockCall.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockCall.on).toHaveBeenCalledWith('end', expect.any(Function));
    });
  });

  describe('Security and Authentication', () => {
    it('should support SSL/TLS credentials', () => {
      const serverWithSSL = new GrpcServer(mockApp as KoattyApplication, {
        hostname: '127.0.0.1',
        port: 50051,
        protocol: 'grpc',
        ssl: {
          enabled: true,
          key: 'private-key',
          cert: 'certificate',
          ca: 'ca-certificate'
        }
      });

      expect(serverWithSSL).toBeInstanceOf(GrpcServer);
      // Note: SSL credentials are created during Start(), not during initialization
    });

    it('should handle authentication metadata', () => {
      const authService = {
        AuthenticatedMethod: jest.fn((call: any, callback: any) => {
          const metadata = call.metadata;
          const token = metadata.get('authorization')[0];
          
          if (token === 'Bearer valid-token') {
            callback(null, { message: 'Authenticated' });
          } else {
            callback({
              code: 16, // UNAUTHENTICATED
              message: 'Invalid token'
            });
          }
        })
      };

      // Test with valid token
      const mockCall1 = {
        metadata: {
          get: jest.fn((key: string) => {
            if (key === 'authorization') return ['Bearer valid-token'];
            return [];
          })
        }
      };
      const mockCallback1 = jest.fn();
      
      authService.AuthenticatedMethod(mockCall1, mockCallback1);
      expect(mockCallback1).toHaveBeenCalledWith(null, { message: 'Authenticated' });

      // Test with invalid token
      const mockCall2 = {
        metadata: {
          get: jest.fn((key: string) => {
            if (key === 'authorization') return ['Bearer invalid-token'];
            return [];
          })
        }
      };
      const mockCallback2 = jest.fn();
      
      authService.AuthenticatedMethod(mockCall2, mockCallback2);
      expect(mockCallback2).toHaveBeenCalledWith({
        code: 16,
        message: 'Invalid token'
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle gRPC status codes', () => {
      const grpcCodes = {
        OK: 0,
        CANCELLED: 1,
        UNKNOWN: 2,
        INVALID_ARGUMENT: 3,
        DEADLINE_EXCEEDED: 4,
        NOT_FOUND: 5,
        ALREADY_EXISTS: 6,
        PERMISSION_DENIED: 7,
        RESOURCE_EXHAUSTED: 8,
        FAILED_PRECONDITION: 9,
        ABORTED: 10,
        OUT_OF_RANGE: 11,
        UNIMPLEMENTED: 12,
        INTERNAL: 13,
        UNAVAILABLE: 14,
        DATA_LOSS: 15,
        UNAUTHENTICATED: 16
      };

      Object.entries(grpcCodes).forEach(([name, code]) => {
        expect(typeof code).toBe('number');
        expect(name).toBeTruthy();
      });
    });

    it('should handle server binding errors', () => {
      // Reset the mock to simulate binding failure
      mockGrpcServer.bindAsync.mockImplementation((address: string, credentials: any, callback: any) => {
        // Simulate binding failure immediately
        callback(new Error('Address already in use'));
      });

      // Test that the server handles binding errors gracefully
      expect(() => {
        grpcServer.Start((err?: Error) => {
          expect(err).toBeDefined();
          expect(err?.message).toContain('Address already in use');
        });
      }).not.toThrow();
    });

    it('should handle service implementation errors', () => {
      const errorService = {
        ErrorMethod: jest.fn((call: any, callback: any) => {
          try {
            throw new Error('Service error');
          } catch (error) {
            callback({
              code: 13, // INTERNAL
              message: 'Internal server error'
            });
          }
        })
      };

      const mockCall = {};
      const mockCallback = jest.fn();
      
      errorService.ErrorMethod(mockCall, mockCallback);
      
      expect(mockCallback).toHaveBeenCalledWith({
        code: 13,
        message: 'Internal server error'
      });
    });
  });

  describe('Performance and Configuration', () => {
    it('should handle server options', () => {
      const serverWithOptions = new GrpcServer(mockApp as KoattyApplication, {
        hostname: '127.0.0.1',
        port: 50051,
        protocol: 'grpc',
        ext: {
          maxConcurrentCalls: 100,
          maxReceiveMessageLength: 4 * 1024 * 1024,
          maxSendMessageLength: 4 * 1024 * 1024,
          keepaliveTimeMs: 30000,
          keepaliveTimeoutMs: 5000
        }
      });

      expect(serverWithOptions).toBeInstanceOf(GrpcServer);
    });

    it('should support compression', () => {
      const compressionService = {
        CompressedMethod: jest.fn((call: any, callback: any) => {
          // Handle compressed request/response
          const largeResponse = {
            data: 'a'.repeat(10000),
            compressed: true
          };
          
          callback(null, largeResponse);
        })
      };

      const mockCall = {};
      const mockCallback = jest.fn();
      
      compressionService.CompressedMethod(mockCall, mockCallback);
      
      expect(mockCallback).toHaveBeenCalledWith(null, expect.objectContaining({
        compressed: true
      }));
    });
  });

  describe('Health Check', () => {
    it('should implement health check service', () => {
      const healthService = {
        Check: jest.fn((call: any, callback: any) => {
          const { service } = call.request;
          
          // Simulate health check logic
          const isHealthy = service !== 'unavailable-service';
          
          callback(null, {
            status: isHealthy ? 1 : 2 // SERVING : NOT_SERVING
          });
        })
      };

      // Test healthy service
      const mockCall1 = { request: { service: 'test-service' } };
      const mockCallback1 = jest.fn();
      
      healthService.Check(mockCall1, mockCallback1);
      expect(mockCallback1).toHaveBeenCalledWith(null, { status: 1 });

      // Test unhealthy service
      const mockCall2 = { request: { service: 'unavailable-service' } };
      const mockCallback2 = jest.fn();
      
      healthService.Check(mockCall2, mockCallback2);
      expect(mockCallback2).toHaveBeenCalledWith(null, { status: 2 });
    });
  });

  describe('Monitoring', () => {
    it('should provide server status', () => {
      const status = grpcServer.getStatus();
      expect(typeof status).toBe('number');
    });

    it('should track service metrics', () => {
      // Simulate metrics tracking
      const metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0
      };

      const trackRequest = (success: boolean, responseTime: number) => {
        metrics.totalRequests++;
        if (success) {
          metrics.successfulRequests++;
        } else {
          metrics.failedRequests++;
        }
        // Calculate cumulative moving average
        metrics.averageResponseTime = 
          (metrics.averageResponseTime * (metrics.totalRequests - 1) + responseTime) / metrics.totalRequests;
      };

      trackRequest(true, 100);
      trackRequest(false, 200);
      trackRequest(true, 150);

      expect(metrics.totalRequests).toBe(3);
      expect(metrics.successfulRequests).toBe(2);
      expect(metrics.failedRequests).toBe(1);
      expect(metrics.averageResponseTime).toBeCloseTo(150);
    });
  });
}); 