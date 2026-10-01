/** 搜索业务逻辑 - 纯函数，不依赖 MCP SDK */

import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import {
  type SearchParams,
  type WebSearchToolConfig,
} from "./types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { calculateRetryDelay, truncateMarkdown } from "./util.js";
import { chatCompletion, type ChatCompletionSuccess } from "./mimo-client.js";
import type { ProgressReporter } from "./progress.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── 错误类型 ──────────────────────────────────────────

/** 可重试的 HTTP 错误（429 / 5xx），由 handleHttpError 抛出，重试循环捕获 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

// ── 工具函数 ──────────────────────────────────────────

/**
 * 类型守卫：检查错误是否为 Node.js 系统错误（带 code 属性）
 * 用于统一处理 ECONNRESET、ECONNREFUSED、ENOTFOUND 等网络错误
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/** 延迟指定毫秒 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 搜索逻辑 ─────────────────────────────────────────

/**
 * 格式化搜索结果
 *
 * 借鉴 grok-build 设计：
 * - 引用去重（同一 URL 只显示一次）
 * - 保持首次出现顺序
 * - 支持 allowed_domains 域名白名单过滤（借鉴 Claude Code WebSearchTool 设计）
 *
 * @returns 格式化后的文本
 */
function formatResult(content: string, annotations: ChatCompletionSuccess["annotations"], allowedDomains?: string[]): string {
  // 先截断 content，再拼接 sources，确保引用来源不被截断
  // truncateMarkdown 在语义边界（段落/换行/句子）截断，并修复断裂的 Markdown 链接
  let result = truncateMarkdown(content, config.maxContentLength);

  // 添加引用来源（chatCompletion 保证 annotations 为数组）
  if (annotations.length > 0) {
    // 去重：同一 URL 只保留首次出现
    const seen = new Set<string>();
    const uniqueAnnotations = annotations.filter((a: ChatCompletionSuccess["annotations"][number]) => {
      const url = a.url;
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });

    // 域名白名单过滤
    const filteredAnnotations =
      allowedDomains && allowedDomains.length > 0
        ? uniqueAnnotations.filter((a: ChatCompletionSuccess["annotations"][number]) => {
            if (!a.url) return false;
            try {
              const hostname = new URL(a.url).hostname;
              return allowedDomains.some(
                (domain) => hostname === domain || hostname.endsWith("." + domain),
              );
            } catch {
              return false;
            }
          })
        : uniqueAnnotations;

    if (filteredAnnotations.length > 0) {
      result += "\n\n--- Sources ---";
      for (const a of filteredAnnotations) {
        const title = a.title || "untitled";
        const siteName = a.site_name || "unknown";
        const url = a.url || "#";
        result += `\n- [${title}](${url}) — ${siteName} (${a.publish_time || "n/a"})`;
      }
    }
  }

  return result;
}

/**
 * 处理 HTTP 错误响应
 * @throws {RetryableError} 429 / 5xx 且还有重试次数时抛出，由调用方捕获重试
 * @returns 终态错误结果（认证失败、参数错误、重试耗尽）
 */
function handleHttpError(status: number, attempt: number): CallToolResult {
  // 认证失败（401/403）→ 401 归因日志已由 mimo-client.ts 处理
  if (status === 401 || status === 403) {
    return {
      content: [{ type: "text", text: "Authentication failed. Please check your MIMO_API_KEY." }],
      isError: true,
    };
  }

  if (status === 429) {
    if (attempt < config.maxRetries) throw new RetryableError("Rate limited", status);
    return {
      content: [{ type: "text", text: "Rate limit exceeded. Please try again later." }],
      isError: true,
    };
  }

  if (status >= 500) {
    if (attempt < config.maxRetries) throw new RetryableError(`Server error ${status}`, status);
    return {
      content: [
        {
          type: "text",
          text: `MiMo service temporarily unavailable (HTTP ${status}). Please try again later.`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Request failed with HTTP ${status}. Please check your query parameters.`,
      },
    ],
    isError: true,
  };
}

/** 执行搜索请求 */
export async function executeSearch(
  params: SearchParams,
  signal?: AbortSignal,
  reqId: string = randomUUID(),
  reporter?: ProgressReporter,
): Promise<CallToolResult> {
  const log = logger.withReqId(reqId);
  const { query, max_keyword, limit, force_search, country, region, city, allowed_domains } = params;

  // 构造 web_search tool 配置
  const webSearchTool: WebSearchToolConfig = {
    type: "web_search",
    max_keyword,
    limit,
    force_search,
  };

  if (country || region || city) {
    webSearchTool.user_location = {
      type: "approximate",
      ...(country && { country }),
      ...(region && { region }),
      ...(city && { city }),
    };
  }

  if (allowed_domains && allowed_domains.length > 0) {
    log.info(`域名白名单（客户端过滤）: ${allowed_domains.join(", ")}`);
  }

  // 重试逻辑
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      log.info(`Sending request (attempt ${attempt + 1}/${config.maxRetries + 1}): ${query.substring(0, 50)}...`);
      await reporter?.report(0, "正在发起搜索...");

      const result = await chatCompletion(
        [{ role: "user", content: query }],
        {
          tools: [webSearchTool],
          signal,
          reqId,
          consumer: "WebSearch",
          attempt,
        },
      );

      if (!result.success) {
        // HTTP 错误（有 status）→ 检查是否可重试（可能抛 RetryableError）
        if (result.code === "http_error" && result.status) {
          return handleHttpError(result.status, attempt);
        }
        // 超时 → 可重试
        if (result.code === "timeout") {
          if (attempt < config.maxRetries) {
            log.info(`Request timed out, retrying (attempt ${attempt + 1}/${config.maxRetries + 1})`);
            await delay(calculateRetryDelay(attempt));
            continue;
          }
          return {
            content: [{ type: "text", text: "Request timed out after retries. The MiMo service may be slow or unavailable. Please try again later." }],
            isError: true,
          };
        }
        // 取消 → 立即返回
        if (result.code === "cancelled") {
          return { content: [{ type: "text", text: "Request cancelled by client." }], isError: true };
        }
        // 其他错误（invalid_response / empty_response）→ 返回
        return { content: [{ type: "text", text: result.error }], isError: true };
      }

      // 确认收到有效响应后才上报「已收到响应」进度（超时/取消不触发）
      await reporter?.report(25, "已收到响应，正在解析...");

      // 成功：格式化结果
      const resultText = formatResult(result.content, result.annotations, allowed_domains);
      log.info(`Response parsed. Content length: ${resultText.length}`);
      await reporter?.report(75, "正在格式化结果...");
      await reporter?.report(100, "搜索完成");
      return { content: [{ type: "text", text: resultText }] };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // 可重试的 HTTP 错误（429 / 5xx）→ 延迟后继续循环
      if (error instanceof RetryableError) {
        await delay(calculateRetryDelay(attempt));
        continue;
      }

      // 可恢复的连接错误 → 重试（DNS 失败 ENOTFOUND 不重试，重试无意义）
      // 注：AbortError（超时/取消）已由 chatCompletion 转为 failure result，不会到达此处
      if (attempt < config.maxRetries && isNodeError(err) && (err.code === "ECONNRESET" || err.code === "ECONNREFUSED")) {
        await delay(calculateRetryDelay(attempt));
        continue;
      }

      // 原始 error.message 仅进日志，不暴露给 LLM（防止泄漏内部 IP、DNS 细节等）
      log.error(`网络错误: ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: "网络错误，请检查网络连接后重试。",
          },
        ],
        isError: true,
      };
    }
  }

  // 不应该到达这里，但 TypeScript 需要
  return {
    content: [{ type: "text", text: "Max retries exceeded. Please try again later." }],
    isError: true,
  };
}
