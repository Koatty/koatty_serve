import { 
  BaseServerOptions,
  HttpServerOptions,
  HttpsServerOptions,
  Http2ServerOptions,
  WebSocketServerOptions,
  GrpcServerOptions,
  KoattyProtocol,
  SSLConfig,
  SSL1Config,
  SSL2Config,
  ConfigHelper
} from '../../src/config/config';
import { KoattyApplication } from 'koatty_core';

describe('Config Module', () => {
  let mockApp: any;

  beforeEach(() => {
    mockApp = {
      config: jest.fn(),
      on: jest.fn(),
      emit: jest.fn()
    };
  });

  describe('ConfigHelper.createHttpConfig', () => {
    it('should create HTTP configuration with defaults', () => {
      const config = ConfigHelper.createHttpConfig(mockApp as KoattyApplication);
      
      expect(config.hostname).toBe('localhost');
      expect(config.port).toBe(3000);
      expect(config.protocol).toBe('http');
      expect(config.trace).toBe(false);
      expect(config.connectionPool).toBeDefined();
      expect(config.connectionPool?.maxConnections).toBe(1000);
    });

    it('should create HTTP configuration with custom options', () => {
      const options = {
        hostname: '0.0.0.0',
        port: 8080,
        protocol: 'http' as KoattyProtocol,
        trace: true,
        ext: { debug: true },
        connectionPool: {
          maxConnections: 500,
          connectionTimeout: 15000,
          keepAliveTimeout: 3000,
          requestTimeout: 25000,
          headersTimeout: 8000
        }
      };

      const config = ConfigHelper.createHttpConfig(mockApp as KoattyApplication, options);
      
      expect(config.hostname).toBe('0.0.0.0');
      expect(config.port).toBe(8080);
      expect(config.trace).toBe(true);
      expect(config.ext?.debug).toBe(true);
      expect(config.connectionPool?.maxConnections).toBe(500);
    });
  });

  describe('ConfigHelper.createHttpsConfig', () => {
    it('should create HTTPS configuration with SSL settings', () => {
      const sslConfig: SSL1Config = {
        mode: 'manual',
        key: 'private-key',
        cert: 'certificate',
        ca: 'ca-certificate'
      };

      const options = {
        hostname: '127.0.0.1',
        port: 443,
        protocol: 'https' as KoattyProtocol,
        ssl: sslConfig,
        ext: {
          key: 'key-content',
          cert: 'cert-content'
        }
      };

      const config = ConfigHelper.createHttpsConfig(mockApp as KoattyApplication, options);
      
      expect(config.protocol).toBe('https');
      expect(config.ssl?.mode).toBe('manual');
      // ext values override ssl values in the current implementation
      expect(config.ssl?.key).toBe('key-content');
      expect(config.ssl?.cert).toBe('cert-content');
      expect(config.ext?.key).toBe('key-content');
    });

    it('should handle different SSL modes', () => {
      const modes: Array<'auto' | 'manual' | 'mutual_tls'> = ['auto', 'manual', 'mutual_tls'];
      
      modes.forEach(mode => {
        const sslConfig: SSL1Config = {
          mode,
          key: 'test-key',
          cert: 'test-cert'
        };

        const config = ConfigHelper.createHttpsConfig(mockApp as KoattyApplication, {
          ssl: sslConfig
        });

        expect(config.ssl?.mode).toBe(mode);
        // Since no ext values provided, ssl values should be empty
        expect(config.ssl?.key).toBe('');
        expect(config.ssl?.cert).toBe('');
      });
    });
  });

  describe('ConfigHelper.createGrpcConfig', () => {
    it('should create gRPC configuration', () => {
      const sslConfig: SSLConfig = {
        enabled: true,
        keyFile: '/path/to/key.pem',
        certFile: '/path/to/cert.pem',
        caFile: '/path/to/ca.pem'
      };

      const options = {
        hostname: '127.0.0.1',
        port: 50051,
        protocol: 'grpc' as KoattyProtocol,
        ssl: sslConfig,
        ext: {
          maxConcurrentCalls: 1000,
          maxReceiveMessageLength: 4 * 1024 * 1024
        }
      };

      const config = ConfigHelper.createGrpcConfig(mockApp as KoattyApplication, options);
      
      expect(config.protocol).toBe('grpc');
      expect(config.port).toBe(50051);
      expect(config.ssl?.enabled).toBe(true);
      expect(config.ext?.maxConcurrentCalls).toBe(1000);
    });
  });

  describe('Type Definitions', () => {
    it('should validate protocol types', () => {
      const validProtocols: KoattyProtocol[] = ['http', 'https', 'http2', 'grpc', 'ws', 'wss'];
      
      validProtocols.forEach(protocol => {
        const config: BaseServerOptions = {
          hostname: '127.0.0.1',
          port: 3000,
          protocol
        };
        
        expect(config.protocol).toBe(protocol);
      });
    });

    it('should validate SSL configuration interfaces', () => {
      const sslConfig: SSLConfig = {
        enabled: true,
        key: 'test-key',
        cert: 'test-cert',
        clientCertRequired: false
      };

      const ssl1Config: SSL1Config = {
        mode: 'manual',
        key: 'test-key',
        cert: 'test-cert',
        requestCert: true,
        rejectUnauthorized: false
      };

      expect(sslConfig.enabled).toBe(true);
      expect(ssl1Config.mode).toBe('manual');
    });
  });

  describe('Configuration Validation', () => {
    it('should handle valid hostname formats', () => {
      const validHostnames = [
        '127.0.0.1',
        'localhost',
        '0.0.0.0',
        'example.com'
      ];

      validHostnames.forEach(hostname => {
        const config = ConfigHelper.createHttpConfig(mockApp as KoattyApplication, {
          hostname
        });
        
        expect(config.hostname).toBe(hostname);
      });
    });

    it('should handle valid port ranges', () => {
      const validPorts = [80, 443, 3000, 8080, 50051];

      validPorts.forEach(port => {
        const config = ConfigHelper.createHttpConfig(mockApp as KoattyApplication, {
          port
        });
        
        expect(config.port).toBe(port);
      });
    });
  });
}); 