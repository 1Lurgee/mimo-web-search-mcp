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
}

/** 创建日志器实例 */
export function createLogger(config: AppConfig): Logger {
  const { logLevel } = config;

  function log(level: LogLevel, ...args: unknown[]): void {
    // ERROR 始终输出；INFO 需要 logLevel >= INFO；DEBUG 需要 logLevel >= DEBUG
    if (level <= logLevel || level === LogLevel.ERROR) {
      console.error(PREFIX, ...args);
    }
  }

  return {
    error: (...args: unknown[]) => log(LogLevel.ERROR, ...args),
    warn: (...args: unknown[]) => log(LogLevel.WARN, ...args),
    info: (...args: unknown[]) => log(LogLevel.INFO, ...args),
    debug: (...args: unknown[]) => log(LogLevel.DEBUG, ...args),
    /** 检查是否启用了 DEBUG 级别，用于避免昂贵的日志参数计算 */
    isDebugEnabled: () => logLevel >= LogLevel.DEBUG,
  };
}
