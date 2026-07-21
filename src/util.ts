/** 共用工具函数 - 消除 search.ts / fetch.ts / fetch-tool.ts 间的重复代码 */

import { loadConfig } from "./config.js";

const config = loadConfig();

// ── AbortSignal 工具 ───────────────────────────────────

/**
 * 合并多个 AbortSignal 为一个——任一信号触发即中止。
 * Node.js >= 20 原生支持 AbortSignal.any()，无需 polyfill。
 *
 * Bug fix: 如果任何信号已中止，立即返回已中止的信号，
 * 而不是过滤掉它导致取消语义丢失。
 */
export function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  if (signals.some((s) => s?.aborted)) return AbortSignal.abort();
  const valid = signals.filter((s) => s);
  if (valid.length === 0) return AbortSignal.abort();
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}

// ── 重试工具 ───────────────────────────────────────────

/**
 * 计算带 jitter 的重试延迟（指数退避 + 随机抖动）
 * 避免多个实例同时重试造成请求洪峰（惊群效应）
 * @param attempt - 当前重试次数（从 0 开始）
 * @returns 延迟毫秒数
 */
export function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = config.retryDelay * Math.pow(2, attempt);
  const jitter = Math.random() * exponentialDelay * 0.5; // 0 ~ 50% 的随机抖动
  return exponentialDelay + jitter;
}

// ── HTTP 超时工具 ──────────────────────────────────────

/** 超时 AbortError 的 reason 标识，用于区分超时与 MCP client 取消 */
export const TIMEOUT_REASON = "request_timeout";

/**
 * 创建超时的 fetch 请求，支持外部 AbortSignal（MCP client 取消时中止请求）
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @param timeoutMs - 超时时间（毫秒），默认从配置读取
 * @param externalSignal - 来自 MCP SDK 的请求级取消信号
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = config.requestTimeout,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(TIMEOUT_REASON), timeoutMs);

  const combinedSignal = externalSignal
    ? mergeAbortSignals(externalSignal, timeoutController.signal)
    : timeoutController.signal;

  try {
    return await fetch(url, { ...options, signal: combinedSignal });
  } finally {
    clearTimeout(timeoutId);
  }
}
