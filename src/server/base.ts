/* 
 * @Description: Base server class with config hot reload support
 * @Usage: 
 * @Author: richen
 * @Date: 2025-04-08 10:45:00
 * @License: BSD (3-Clause)
 */

import { KoattyApplication, KoattyServer, NativeServer } from "koatty_core";
import { createLogger } from "../utils/structured-logger";
import { deepEqual } from "../utils/helper";

// KoattyProtocol
export type KoattyProtocol = 'http' | "https" | 'http2' | 'grpc' | 'ws' | 'wss';
/**
 * listening options
 *
 * @interface ListeningOptions
 */
export interface ListeningOptions {
  hostname: string;
  port: number;
  protocol: KoattyProtocol;
  ext?: Record<string, any>; // Other extended configuration
}

/**
 * Base server class with config hot reload support
 */
export abstract class BaseServer<T extends ListeningOptions = ListeningOptions> implements KoattyServer {
  options: T;
  readonly server: any; // Use any to allow different server implementations (http/https/ws/grpc/http2)
  readonly protocol: string;
  status: number;
  listenCallback?: () => void;
  protected configVersion = 0;
  protected logger = createLogger({ module: 'base' });

  constructor(protected app: KoattyApplication, options: T) {
    this.options = { ...options };
    this.protocol = options.protocol;
    this.status = 0;
    
    // Set logger context
    this.logger = createLogger({ 
      module: 'base', 
      protocol: options.protocol 
    });

    this.logger.debug('Base server constructed', {}, {
      protocol: options.protocol,
      hostname: options.hostname,
      port: options.port
    });
  }

  /**
   * Update server config
   * @param newConfig Partial config to update
   * @returns Whether config was changed
   */
  updateConfig(newConfig: Partial<ListeningOptions>): boolean {
    const changes = this.diffConfig(newConfig);
    if (changes.length === 0) {
      this.logger.debug('No configuration changes detected');
      return false;
    }

    try {
      this.logger.info('Applying configuration changes', {}, {
        changes,
        newConfig: newConfig
      });
      
      this.applyConfigChanges(changes, newConfig);
      this.configVersion++;
      
      this.logger.info('Configuration updated successfully', {}, {
        configVersion: this.configVersion
      });
      
      return true;
    } catch (err) {
      this.logger.error('Config update failed', {}, err);
      return false;
    }
  }

  private diffConfig(newConfig: Partial<ListeningOptions>): (keyof ListeningOptions)[] {
    const changes: (keyof ListeningOptions)[] = [];
    for (const key in newConfig) {
      const typedKey = key as keyof ListeningOptions;
      if (!deepEqual(this.options[typedKey], newConfig[typedKey])) {
        changes.push(typedKey);
      }
    }
    return changes;
  }

  protected abstract applyConfigChanges(
    changedKeys: (keyof ListeningOptions)[],
    newConfig: Partial<ListeningOptions>
  ): void;

  // Implement KoattyServer interface
  abstract Start(listenCallback?: () => void): any;
  abstract Stop(callback?: () => void): void;

  abstract getStatus(): number;
  abstract getNativeServer(): NativeServer;
}
