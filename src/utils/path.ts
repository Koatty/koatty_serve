/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2024-01-07 22:33:25
 * @LastEditTime: 2024-01-07 22:39:31
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
/**
 * @description: 
 * @param {string} path
 * @return {*}
 */
export function parsePath(opath: string): string {
  let path = opath || "/";
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, path.length - 1);
  }
  return path.replace('//', '/');
}