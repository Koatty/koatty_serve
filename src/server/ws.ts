/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-11-12 11:29:16
 * @LastEditTime: 2025-04-08 10:48:00
 */
import { Server as HttpServer, IncomingMessage, createServer } from "http";
import { Server as HttpsServer, createServer as httpsCreateServer, ServerOptions as httpsServerOptions } from "https";
import { KoattyApplication, NativeServer } from 'koatty_core';
import { ServerOptions, WebSocketServer, WebSocket } from 'ws';
import { CreateTerminus } from "../utils/terminus";
import { BaseServer, ListeningOptions } from "./base";
import { createLogger, generateConnectionId, generateTraceId, LogContext } from "../utils/structured-logger";

export interface WebSocketServerOptions extends ListeningOptions {
  wsOptions?: ServerOptions;
  maxConnections?: number; // 最大连接数限制
  connectionTimeout?: number; // 连接超时时间(ms)
}

/**
 * WebSocket connection manager with structured logging
 */
class ConnectionManager {
  private connections = new Set<WebSocket>();
  private connectionData = new WeakMap<WebSocket, { 
    connectTime: number; 
    lastActivity: number;
    connectionId: string;
    traceId: string;
  }>();
  private logger = createLogger({ module: 'websocket', action: 'connection_manager' });
  
  constructor(
    private maxConnections: number = 1000,
    private connectionTimeout: number = 30000 // 30秒超时
  ) {
    this.logger.info('Connection manager initialized', {}, {
      maxConnections: this.maxConnections,
      connectionTimeout: this.connectionTimeout
    });
  }

  /**
   * Add new connection
   */
  addConnection(ws: WebSocket): boolean {
    if (this.connections.size >= this.maxConnections) {
      this.logger.logSecurityEvent('rate_limit', {}, {
        reason: 'max_connections_reached',
        current: this.connections.size,
        limit: this.maxConnections
      });
      return false;
    }

    const connectionId = generateConnectionId();
    const traceId = generateTraceId();
    
    this.connections.add(ws);
    this.connectionData.set(ws, {
      connectTime: Date.now(),
      lastActivity: Date.now(),
      connectionId,
      traceId
    });

    this.logger.logConnectionEvent('connected', { connectionId, traceId }, {
      totalConnections: this.connections.size,
      maxConnections: this.maxConnections
    });
    
    return true;
  }

  /**
   * Remove connection
   */
  removeConnection(ws: WebSocket): void {
    const data = this.connectionData.get(ws);
    
    if (this.connections.has(ws)) {
      this.connections.delete(ws);
      this.connectionData.delete(ws);
      
      if (data) {
        const duration = Date.now() - data.connectTime;
        this.logger.logConnectionEvent('disconnected', {
          connectionId: data.connectionId,
          traceId: data.traceId
        }, {
          duration: `${duration}ms`,
          totalConnections: this.connections.size,
          maxConnections: this.maxConnections
        });
      }
    }
  }

  /**
   * Update connection activity
   */
  updateActivity(ws: WebSocket): void {
    const data = this.connectionData.get(ws);
    if (data) {
      data.lastActivity = Date.now();
    }
  }

  /**
   * Get connection context for logging
   */
  getConnectionContext(ws: WebSocket): LogContext {
    const data = this.connectionData.get(ws);
    return data ? {
      connectionId: data.connectionId,
      traceId: data.traceId
    } : {};
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all connections
   */
  closeAllConnections(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connections.size === 0) {
        this.logger.info('No connections to close');
        resolve();
        return;
      }

      let closedCount = 0;
      const totalConnections = this.connections.size;

      this.logger.info('Closing all connections', {}, {
        totalConnections
      });

      this.connections.forEach((ws) => {
        const data = this.connectionData.get(ws);
        const context = data ? { connectionId: data.connectionId, traceId: data.traceId } : {};

        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Server shutting down');
          this.logger.debug('Sent close signal to connection', context);
        }
        
        const cleanup = () => {
          this.removeConnection(ws);
          closedCount++;
          if (closedCount >= totalConnections) {
            this.logger.info('All connections closed successfully');
            resolve();
          }
        };

        // Set timeout in case close event doesn't fire
        setTimeout(cleanup, 1000);
        
        ws.once('close', cleanup);
      });

      // Fallback timeout
      setTimeout(() => {
        if (closedCount < totalConnections) {
          const forceClosed = totalConnections - closedCount;
          this.logger.warn('Force closing connections due to timeout', {}, {
            forceClosed,
            totalConnections
          });
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections(): void {
    const now = Date.now();
    const staleConnections: { ws: WebSocket; data: any }[] = [];

    this.connections.forEach((ws) => {
      const data = this.connectionData.get(ws);
      if (data && (now - data.lastActivity) > this.connectionTimeout) {
        staleConnections.push({ ws, data });
      }
    });

    if (staleConnections.length > 0) {
      this.logger.info('Cleaning up stale connections', {}, {
        staleCount: staleConnections.length,
        timeout: this.connectionTimeout
      });

      staleConnections.forEach(({ ws, data }) => {
        this.logger.logConnectionEvent('timeout', {
          connectionId: data.connectionId,
          traceId: data.traceId
        }, {
          inactiveTime: now - data.lastActivity
        });
        
        ws.close(1000, 'Connection timeout');
        this.removeConnection(ws);
      });
    }
  }
}

export class WsServer extends BaseServer<WebSocketServerOptions> {
  readonly server: WebSocketServer;
  readonly httpServer: HttpServer | HttpsServer;
  private connectionManager: ConnectionManager;
  private cleanupInterval?: NodeJS.Timeout;
  private upgradeHandler?: (request: any, socket: any, head: any) => void;
  private clientErrorHandler?: (err: any, sock: any) => void;
  private logger = createLogger({ module: 'websocket', protocol: 'ws' });
  private serverId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  socket: any;

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, options);
    options.ext = options.ext || {};
    
    // Set server context for logging
    this.logger = createLogger({ 
      module: 'websocket', 
      protocol: options.protocol,
      serverId: this.serverId
    });

    // Initialize connection manager
    this.connectionManager = new ConnectionManager(
      options.maxConnections || 1000,
      options.connectionTimeout || 30000
    );

    this.logger.info('Initializing WebSocket server', {}, {
      hostname: options.hostname,
      port: options.port,
      protocol: options.protocol,
      maxConnections: options.maxConnections || 1000,
      connectionTimeout: options.connectionTimeout || 30000
    });

    if (options.ext.server){
      this.httpServer = options.ext.server;
      this.logger.debug('Using external HTTP server');
    } else {
      if (this.options.protocol == "wss") {
        const opt: httpsServerOptions = {
          key: this.options.ext.key,
          cert: this.options.ext.cert,
        };
        this.httpServer = httpsCreateServer(opt);
        this.logger.debug('Created HTTPS server for WSS');
      } else {
        this.httpServer = createServer();
        this.logger.debug('Created HTTP server for WS');
      }
    }

    // Configure WebSocket server with noServer: true to handle upgrade manually
    this.options.wsOptions = {
      noServer: true,
    };

    this.server = new WebSocketServer(this.options.wsOptions);

    // Set up periodic cleanup of stale connections
    this.cleanupInterval = setInterval(() => {
      this.connectionManager.cleanupStaleConnections();
    }, 10000); // Check every 10 seconds

    this.logger.debug('WebSocket server initialized successfully');

    CreateTerminus(this);
  }

  protected applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ) {
    this.options = { ...this.options, ...newConfig };

    if (changedKeys.includes('port') || changedKeys.includes('hostname')) {
      this.logger.info('Restarting server with new address configuration');
      this.Stop().then(() => {
        this.Start();
      });
    }
  }

  /**
   * Return an HTTP server
   */
  Start(): NativeServer {
    const traceId = generateTraceId();
    this.logger.logServerEvent('starting', { traceId }, {
      hostname: this.options.hostname,
      port: this.options.port,
      protocol: this.options.protocol
    });

    // Set up upgrade handler for HTTP server
    this.upgradeHandler = (request: IncomingMessage, socket: any, head: Buffer) => {
      try {
        this.server.handleUpgrade(request, socket, head, (ws) => {
          this.onConnection(ws, request);
        });
      } catch (error) {
        this.logger.error('WebSocket upgrade failed', { traceId }, error);
        socket.destroy();
      }
    };

    // Set up client error handler
    this.clientErrorHandler = (err: Error, socket: any) => {
      this.logger.error('HTTP client error', { traceId }, err);
      socket.destroy();
    };

    (this.httpServer as any).on('upgrade', this.upgradeHandler);
    (this.httpServer as any).on('clientError', this.clientErrorHandler);

    return this.httpServer.listen(this.options.port, this.options.hostname, () => {
      const addr = this.httpServer.address();
      this.logger.logServerEvent('started', { traceId }, {
        address: addr,
        hostname: this.options.hostname,
        port: this.options.port,
        protocol: this.options.protocol
      });
    }).on("error", (err: Error) => {
      this.logger.logServerEvent('error', { traceId }, err);
    });
  }

  /**
   * Stop Server
   */
  Stop(): Promise<any> {
    const traceId = generateTraceId();
    this.logger.logServerEvent('stopping', { traceId });

    return new Promise(async (resolve, reject) => {
      try {
        // Clear cleanup interval
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = undefined;
        }

        // Close all WebSocket connections
        await this.connectionManager.closeAllConnections();

        // Remove HTTP server event listeners
        if (this.upgradeHandler) {
          (this.httpServer as any).removeListener('upgrade', this.upgradeHandler);
        }
        if (this.clientErrorHandler) {
          (this.httpServer as any).removeListener('clientError', this.clientErrorHandler);
        }

        // Close HTTP server if it was created by this class
        if (!this.options.ext?.server) {
          this.httpServer.close(() => {
            this.logger.logServerEvent('stopped', { traceId });
            resolve(void 0);
          });
        } else {
          this.logger.logServerEvent('stopped', { traceId });
          resolve(void 0);
        }
      } catch (error) {
        this.logger.logServerEvent('error', { traceId }, error);
        reject(error);
      }
    });
  }

  /**
   * Get status
   * @returns 
   */
  getStatus(): number {
    return this.status;
  }

  /**
   * Get native server
   * @returns 
   */
  getNativeServer(): NativeServer {
    return this.server;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): { current: number; max: number } {
    return {
      current: this.connectionManager.getConnectionCount(),
      max: this.options.maxConnections || 1000
    };
  }

  /**
   * Handle WebSocket connection
   */
  private onConnection(ws: WebSocket, request: IncomingMessage): void {
    // Check connection limits and add to manager
    if (!this.connectionManager.addConnection(ws)) {
      ws.close(1013, 'Server overloaded');
      return;
    }

    const connectionContext = this.connectionManager.getConnectionContext(ws);
    const clientInfo = {
      url: request.url,
      userAgent: request.headers['user-agent'],
      origin: request.headers.origin,
      ip: request.socket.remoteAddress
    };

    this.logger.logConnectionEvent('connected', connectionContext, clientInfo);

    // Handle messages
    ws.on('message', (message: Buffer) => {
      this.connectionManager.updateActivity(ws);
      
      try {
        this.logger.debug('Message received', connectionContext, {
          size: message.length,
          type: typeof message
        });
        
        // 触发应用层的消息处理
        this.app.emit('websocket_message', ws, message, request);
      } catch (error) {
        this.logger.logConnectionEvent('error', connectionContext, error);
      }
    });

    // Handle connection close
    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.debug('Connection closing', connectionContext, {
        code,
        reason: reason.toString()
      });
      this.connectionManager.removeConnection(ws);
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      this.logger.logConnectionEvent('error', connectionContext, error);
      this.connectionManager.removeConnection(ws);
    });

    // 触发应用层的连接事件
    this.app.emit('websocket_connection', ws, request);
  }
}
