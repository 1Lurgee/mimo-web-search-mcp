/**
 * API 错误日志模块（简化版）
 *
 * 本地使用：直接写日志，不需要复杂的回调机制
 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── 类型定义 ──────────────────────────────────────────

/** 消费者标识 */
export type ToolConsumer = "WebSearch" | "WebFetch" | "MiMoAPI";

// ── 工具函数 ──────────────────────────────────────────

/**
 * 记录 401 认证失败
 * 本地使用直接写日志
 */
export function emit401(
  consumer: ToolConsumer,
  _bearer?: string,
  details?: Record<string, unknown>,
): void {
  logger.warn(`API 401 认证失败: consumer=${consumer}`, details);
}

/**
 * 兼容旧代码的空实现
 * @deprecated 本地使用不需要自定义回调
 */
export function setAttributionCallback(_callback: unknown): void {
  // no-op
}
