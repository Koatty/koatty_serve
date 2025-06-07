
/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2024-11-07 11:08:26
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

/**
 * Performs a deep equality comparison between two objects.
 * @param obj1 - The first object to compare
 * @param obj2 - The second object to compare
 * @param visited - Set to track visited objects for circular reference detection
 * @returns {boolean} True if objects are deeply equal, false otherwise
 */
export function deepEqual(obj1: any, obj2: any, visited = new WeakSet()): boolean {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;

  if (typeof obj1 === 'object') {
    // Handle circular references
    if (visited.has(obj1)) return true;
    visited.add(obj1);
    
    // Check if both are arrays or both are objects
    const isArray1 = Array.isArray(obj1);
    const isArray2 = Array.isArray(obj2);
    if (isArray1 !== isArray2) return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;

    const result = keys1.every(key => deepEqual(obj1[key], obj2[key], visited));
    visited.delete(obj1);
    return result;
  }

  return false;
}

  /**
   * Execute operation with timeout
   */
 export function executeWithTimeout<T>(
    operation: () => Promise<T> | T,
    timeout: number,
    operationName: string
  ): Promise < T > {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve(operation())
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

/**
 * Generate a unique server ID
 * @param protocol - The protocol of the server
 * @returns {string} The server ID
 */
export function generateServerId(protocol: string): string {
  return `${protocol}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}