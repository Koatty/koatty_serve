/*
 * @Description: Health check and metrics HTTP endpoints
 * @Usage: 
 * @Author: richen
 * @Date: 2024-11-27 18:00:00
 * @LastEditTime: 2024-11-27 18:00:00
 */
import { IncomingMessage, ServerResponse } from 'http';
import { BaseServer, HealthCheckResult, PerformanceMetrics, HealthStatus } from '../server/base';
import { createLogger } from './logger';

/**
 * Health and metrics endpoints handler
 */
export class HealthEndpointsHandler {
  private logger = createLogger({ module: 'health_endpoints' });
  private servers = new Map<string, BaseServer>();

  /**
   * Register a server for health checks and metrics
   */
  registerServer(serverId: string, server: BaseServer): void {
    this.servers.set(serverId, server);
    this.logger.info('Server registered for health monitoring', {}, {
      serverId,
      protocol: server.protocol,
      serversCount: this.servers.size
    });
  }

  /**
   * Unregister a server
   */
  unregisterServer(serverId: string): void {
    if (this.servers.delete(serverId)) {
      this.logger.info('Server unregistered from health monitoring', {}, {
        serverId,
        remainingServers: this.servers.size
      });
    }
  }

  /**
   * Handle health check endpoint
   */
  async handleHealthCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const serverId = url.searchParams.get('server');
      const detailed = url.searchParams.get('detailed') === 'true';

      const healthResults: Record<string, HealthCheckResult | null> = {};
      let overallStatus = HealthStatus.HEALTHY;

      if (serverId) {
        // Health check for specific server
        const server = this.servers.get(serverId);
        if (!server) {
          this.sendError(res, 404, 'Server not found');
          return;
        }
        
        const health = server.getHealthStatus();
        healthResults[serverId] = health;
        
        if (health?.status === HealthStatus.UNHEALTHY) {
          overallStatus = HealthStatus.UNHEALTHY;
        } else if (health?.status === HealthStatus.DEGRADED && overallStatus === HealthStatus.HEALTHY) {
          overallStatus = HealthStatus.DEGRADED;
        }
      } else {
        // Health check for all servers
        for (const [id, server] of this.servers) {
          const health = server.getHealthStatus();
          healthResults[id] = health;
          
          if (health?.status === HealthStatus.UNHEALTHY) {
            overallStatus = HealthStatus.UNHEALTHY;
          } else if (health?.status === HealthStatus.DEGRADED && overallStatus === HealthStatus.HEALTHY) {
            overallStatus = HealthStatus.DEGRADED;
          }
        }
      }

      const response = {
        status: overallStatus,
        timestamp: Date.now(),
        servers: detailed ? healthResults : Object.keys(healthResults).reduce((acc, key) => {
          acc[key] = healthResults[key]?.status || HealthStatus.UNHEALTHY;
          return acc;
        }, {} as Record<string, HealthStatus>)
      };

      const statusCode = overallStatus === HealthStatus.HEALTHY ? 200 : 
                        overallStatus === HealthStatus.DEGRADED ? 200 : 503;

      this.sendJSON(res, statusCode, response);

    } catch (error) {
      this.logger.error('Health check endpoint error', {}, error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  /**
   * Handle metrics endpoint
   */
  async handleMetrics(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const serverId = url.searchParams.get('server');
      const format = url.searchParams.get('format') || 'json';
      const history = url.searchParams.get('history') === 'true';

      const metricsResults: Record<string, PerformanceMetrics | PerformanceMetrics[] | null> = {};

      if (serverId) {
        // Metrics for specific server
        const server = this.servers.get(serverId);
        if (!server) {
          this.sendError(res, 404, 'Server not found');
          return;
        }
        
        metricsResults[serverId] = history ? 
          server.getMetricsHistory() : 
          server.getPerformanceMetrics();
      } else {
        // Metrics for all servers
        for (const [id, server] of this.servers) {
          metricsResults[id] = history ? 
            server.getMetricsHistory() : 
            server.getPerformanceMetrics();
        }
      }

      if (format === 'prometheus') {
        this.sendPrometheusMetrics(res, metricsResults);
      } else {
        const response = {
          timestamp: Date.now(),
          format,
          history,
          servers: metricsResults
        };
        
        this.sendJSON(res, 200, response);
      }

    } catch (error) {
      this.logger.error('Metrics endpoint error', {}, error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  /**
   * Handle server list endpoint
   */
  async handleServerList(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const servers = Array.from(this.servers.entries()).map(([id, server]) => ({
        id,
        protocol: server.protocol,
        status: server.getStatus(),
        healthStatus: server.getHealthStatus()?.status || HealthStatus.UNHEALTHY,
        activeConnections: server.getConnectionStats?.()?.activeConnections || server.getActiveConnections?.() || 0,
        uptime: server.getPerformanceMetrics()?.uptime || 0
      }));

      const response = {
        timestamp: Date.now(),
        count: servers.length,
        servers
      };

      this.sendJSON(res, 200, response);

    } catch (error) {
      this.logger.error('Server list endpoint error', {}, error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  /**
   * Send JSON response
   */
  private sendJSON(res: ServerResponse, statusCode: number, data: any): void {
    const json = JSON.stringify(data, null, 2);
    
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.end(json);
  }

  /**
   * Send Prometheus format metrics
   */
  private sendPrometheusMetrics(res: ServerResponse, metricsResults: Record<string, PerformanceMetrics | PerformanceMetrics[] | null>): void {
    const lines: string[] = [];
    
    // Add help and type information
    lines.push('# HELP koatty_uptime_seconds Server uptime in seconds');
    lines.push('# TYPE koatty_uptime_seconds counter');
    lines.push('# HELP koatty_connections_active Current active connections');
    lines.push('# TYPE koatty_connections_active gauge');
    lines.push('# HELP koatty_memory_usage_bytes Memory usage in bytes');
    lines.push('# TYPE koatty_memory_usage_bytes gauge');
    lines.push('# HELP koatty_requests_total Total number of requests');
    lines.push('# TYPE koatty_requests_total counter');
    
    for (const [serverId, metrics] of Object.entries(metricsResults)) {
      if (!metrics || Array.isArray(metrics)) continue;
      
      const labels = `{server="${serverId}",protocol="${serverId.split('_')[0]}"}`;
      
      lines.push(`koatty_uptime_seconds${labels} ${(metrics.uptime / 1000).toFixed(3)}`);
      lines.push(`koatty_connections_active${labels} ${metrics.connections.activeConnections}`);
      lines.push(`koatty_memory_usage_bytes${labels} ${metrics.memoryUsage.heapUsed}`);
      lines.push(`koatty_requests_total${labels} ${metrics.requests.total}`);
    }
    
    const content = lines.join('\n') + '\n';
    
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Content-Length': Buffer.byteLength(content),
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    
    res.end(content);
  }

  /**
   * Send error response
   */
  private sendError(res: ServerResponse, statusCode: number, message: string): void {
    const error = { error: message, timestamp: Date.now() };
    this.sendJSON(res, statusCode, error);
  }
}

/**
 * Create middleware to handle health and metrics endpoints
 */
export function createHealthMiddleware(handler: HealthEndpointsHandler) {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url || '/';
    
    // Health check endpoint
    if (url.startsWith('/health')) {
      await handler.handleHealthCheck(req, res);
      return;
    }
    
    // Metrics endpoint
    if (url.startsWith('/metrics')) {
      await handler.handleMetrics(req, res);
      return;
    }
    
    // Server list endpoint
    if (url.startsWith('/servers')) {
      await handler.handleServerList(req, res);
      return;
    }
    
    // Not a health/metrics endpoint, continue to next middleware
    if (next) next();
  };
}

// Global instance for easy access
export const globalHealthHandler = new HealthEndpointsHandler(); 