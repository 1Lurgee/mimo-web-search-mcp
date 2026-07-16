/** 日志工具 - 通过配置控制日志级别 */

import { type AppConfig, LogLevel } from "./config.js";

const PREFIX = "[mimo-web-search]";

/** 日志器实例类型 */
export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  /** 检查是否启用了 DEBUG 级别，用于避免昂贵的日志参数计算 */
  isDebugEnabled: () => boolean;
  /**
   * 创建带请求 ID 前缀的子日志器
   * 用于并发场景下区分不同请求的日志
   */
  withReqId(reqId: string): Logger;
}

/** 创建日志器实例 */
export function createLogger(config: AppConfig): Logger {
  const { logLevel } = config;

  function createScopedLogger(prefix: string): Logger {
    function log(level: LogLevel, ...args: unknown[]): void {
      if (level <= logLevel || level === LogLevel.ERROR) {
        console.error(prefix, ...args);
      }
    }

    return {
      error: (...args: unknown[]) => log(LogLevel.ERROR, ...args),
      warn: (...args: unknown[]) => log(LogLevel.WARN, ...args),
      info: (...args: unknown[]) => log(LogLevel.INFO, ...args),
      debug: (...args: unknown[]) => log(LogLevel.DEBUG, ...args),
      isDebugEnabled: () => logLevel >= LogLevel.DEBUG,
      withReqId: (reqId: string) => createScopedLogger(`${prefix} [req:${reqId}]`),
    };
  }

  return createScopedLogger(PREFIX);
}
