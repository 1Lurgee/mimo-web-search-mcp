/** 搜索业务逻辑 - 纯函数，不依赖 MCP SDK */

import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import {
  MimoResponseSchema,
  type MimoRequestBody,
  type MimoResponse,
  type SearchParams,
  type WebSearchToolConfig,
} from "./types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { calculateRetryDelay, fetchWithTimeout, truncateMarkdown, TIMEOUT_REASON } from "./util.js";
import { emit401 } from "./attribution.js";
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

// ── HTTP 客户端（共用工具已迁移至 ./util.ts）──────────

// ── 搜索逻辑 ─────────────────────────────────────────

/**
 * 格式化搜索结果
 *
 * 借鉴 grok-build 设计：
 * - 引用去重（同一 URL 只显示一次）
 * - 保持首次出现顺序
 * - 支持 allowed_domains 域名白名单过滤（借鉴 Claude Code WebSearchTool 设计）
 *
 * @returns 格式化后的文本，或 null 表示响应无效（choices 为空或 message 缺失）
 */
function formatResult(data: MimoResponse, allowedDomains?: string[]): string | null {
  // 安全访问：choices 和 message 都可能为 undefined
  const message = data.choices?.[0]?.message;
  if (!message) return null;

  // 先截断 content，再拼接 sources，确保引用来源不被截断
  let result = truncateMarkdown(message.content || "(no content)", config.maxContentLength);

  // 添加引用来源（借鉴 grok-build 去重逻辑）
  const annotations = message.annotations || [];
  if (annotations.length > 0) {
    // 去重：同一 URL 只保留首次出现
    const seen = new Set<string>();
    const uniqueAnnotations = annotations.filter((a) => {
      const url = a.url;
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });

    // 域名白名单过滤（借鉴 Claude Code WebSearchTool 的 allowed_domains 设计）
    const filteredAnnotations =
      allowedDomains && allowedDomains.length > 0
        ? uniqueAnnotations.filter((a) => {
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
  if (status === 401 || status === 403) {
    // 记录 401 归因事件（借鉴 grok-build 设计）
    if (status === 401) {
      emit401("WebSearch", config.apiKey, { status, attempt });
    }
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

  // 域名白名单过滤（借鉴 Claude Code WebSearchTool 设计）
  // MiMo API 不直接支持此参数，所以在结果层面做客户端后过滤
  if (allowed_domains && allowed_domains.length > 0) {
    log.info(`域名白名单（客户端过滤）: ${allowed_domains.join(", ")}`);
  }

  const body: MimoRequestBody = {
    model: config.model,
    messages: [{ role: "user", content: query }],
    tools: [webSearchTool],
    max_completion_tokens: config.maxCompletionTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stream: false, // 强制非流式：MCP 工具需要完整响应，且 resp.json() 不兼容 SSE 格式
    thinking: { type: config.thinking ? "enabled" : "disabled" },
  };

  // 仅在 DEBUG 级别启用时才序列化请求体，避免不必要的 JSON.stringify 开销
  if (log.isDebugEnabled()) {
    log.debug("Request body:", JSON.stringify(body, null, 2));
  }

  // 重试逻辑
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      log.info(`Sending request (attempt ${attempt + 1}/${config.maxRetries + 1}): ${query.substring(0, 50)}...`);
      await reporter?.report(0, "正在发起搜索...");

      const resp = await fetchWithTimeout(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "api-key": config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        config.requestTimeout,
        signal,
      );

      log.info(`Response status: ${resp.status}`);
      await reporter?.report(25, "已收到响应，正在解析...");

      if (!resp.ok) {
        await resp.text().catch(() => ""); // 消耗响应体
        // 429 / 5xx 且还有重试次数 → 抛出 RetryableError，由外层 catch 捕获重试
        // 其他状态码 → 直接返回终态错误
        return handleHttpError(resp.status, attempt);
      }

      // 解析并校验 JSON 响应（Zod 运行时校验，拒绝结构不符的响应）
      const rawData: unknown = await resp.json();
      // 仅在 DEBUG 级别启用时才序列化响应数据，避免对大响应体的不必要开销
      if (log.isDebugEnabled()) {
        log.debug("Response data:", JSON.stringify(rawData, null, 2));
      }

      const parsed = MimoResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        log.error("Response schema validation failed:", parsed.error.message);
        return {
          content: [{ type: "text", text: "Invalid response format from MiMo API. Please try again." }],
          isError: true,
        };
      }

      const data = parsed.data;
      if (!data.choices || data.choices.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No response received from MiMo API. The service may be temporarily unavailable.",
            },
          ],
          isError: true,
        };
      }

      const resultText = formatResult(data, allowed_domains);
      if (resultText === null) {
        return {
          content: [{ type: "text", text: "Empty response from MiMo API." }],
          isError: true,
        };
      }
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

      // AbortError 区分两种来源：
      // 1. MCP client 主动取消 → 立即返回，不重试
      // 2. 内部超时 → 可重试（服务器可能暂时繁忙）
      if (error.name === "AbortError") {
        const isTimeout = "cause" in error && (error as { cause: unknown }).cause === TIMEOUT_REASON;
        if (isTimeout && attempt < config.maxRetries) {
          log.info(`Request timed out, retrying (attempt ${attempt + 1}/${config.maxRetries + 1})`);
          await delay(calculateRetryDelay(attempt));
          continue;
        }
        return {
          content: [
            {
              type: "text",
              text: isTimeout
                ? "Request timed out after retries. The MiMo service may be slow or unavailable. Please try again later."
                : "Request cancelled by client.",
            },
          ],
          isError: true,
        };
      }

      // 可恢复的连接错误 → 重试（DNS 失败 ENOTFOUND 不重试，重试无意义）
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
