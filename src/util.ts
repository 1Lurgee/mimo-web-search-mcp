/** 共用工具函数 - 消除 search.ts / fetch.ts / fetch-tool.ts / convert.ts / overflow.ts 间的重复代码 */

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

// ── 内容截断工具 ──────────────────────────────────────

/**
 * 截断过长内容，按段落/换行/句子边界截断，避免破坏语义结构
 * 特别处理 Markdown 链接：避免在 [text 中间截断导致语法损坏
 *
 * 被 convert.ts、overflow.ts、search.ts、fetch-tool.ts 共用，
 * 消除原先四处重复的截断逻辑。
 *
 * @param text - 原始文本
 * @param maxLength - 最大字符数
 * @returns 截断后的文本（含截断通知），或原文（未超长时）
 */
export function truncateMarkdown(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const truncationNotice = "\n\n[Content truncated due to size limit...]";

  // 依次尝试按段落、换行、句号截断，保留最完整的语义单元
  const boundaries = ["\n\n", "\n", ". "];
  let cutPoint = -1;
  for (const boundary of boundaries) {
    const idx = truncated.lastIndexOf(boundary);
    if (idx > maxLength / 2) {
      cutPoint = idx + boundary.length;
      break;
    }
  }

  // 无合适边界，硬截断
  const base = cutPoint >= 0 ? truncated.substring(0, cutPoint).trimEnd() : truncated;

  // 修复截断可能破坏的 Markdown 链接：移除末尾不完整的 [text 片段
  // 始终检查末尾是否有未闭合的 [（即使文本中包含其他完整链接）
  const lastOpen = base.lastIndexOf("[");
  const lastClose = base.lastIndexOf("]");
  if (lastOpen > lastClose) {
    // 最后一个 [ 没有对应的 ]，说明被截断了，移除该 [ 及其后的内容
    return base.substring(0, lastOpen).trimEnd() + truncationNotice;
  }

  return base + truncationNotice;
}
