/** 日志工具 - 通过配置控制日志级别 */

import { type AppConfig, LogLevel } from "./config.js";

const PREFIX = "[mimo-web-search]";

/** 创建日志器实例 */
export function createLogger(config: AppConfig) {
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
  };
}

export type Logger = ReturnType<typeof createLogger>;
