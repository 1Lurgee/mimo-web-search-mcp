#!/usr/bin/env node
/** MiMo Web Search MCP Server
 *  Wraps Xiaomi MiMo's web_search API as an MCP tool for Claude Code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pLimit from "p-limit";
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

// ── 加载配置 ─────────────────────────────────────────

/** 可重试的 HTTP 错误（429 / 5xx），由 handleHttpError 抛出，重试循环捕获 */
class RetryableError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

const config = loadConfig();
const logger = createLogger(config);
const limitConcurrency = pLimit(config.maxConcurrent);

// ── 辅助函数 ─────────────────────────────────────────

/**
 * 类型守卫：检查错误是否为 Node.js 系统错误（带 code 属性）
 * 用于统一处理 ECONNRESET、ECONNREFUSED、ENOTFOUND 等网络错误
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/** 截断过长内容，按段落/换行/句子边界截断，避免破坏语义结构 */
function truncateContent(text: string): string {
  if (text.length <= config.maxContentLength) return text;

  const truncated = text.substring(0, config.maxContentLength);
  const truncationNotice = "\n\n[Content truncated due to size limit...]";

  // 依次尝试按段落、换行、句号截断，保留最完整的语义单元
  const boundaries = ["\n\n", "\n", ". "];
  for (const boundary of boundaries) {
    const lastIdx = truncated.lastIndexOf(boundary);
    // 至少保留一半内容，避免截断过短
    if (lastIdx > config.maxContentLength / 2) {
      return truncated.substring(0, lastIdx + boundary.length).trimEnd() + truncationNotice;
    }
  }

  // 无合适边界，硬截断
  return truncated + truncationNotice;
}

/** 延迟指定毫秒 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算带 jitter 的重试延迟（指数退避 + 随机抖动）
 * 避免多个实例同时重试造成请求洪峰（惊群效应）
 * @param attempt - 当前重试次数（从 0 开始）
 * @returns 延迟毫秒数
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = config.retryDelay * Math.pow(2, attempt);
  const jitter = Math.random() * exponentialDelay * 0.5; // 0 ~ 50% 的随机抖动
  return exponentialDelay + jitter;
}

/**
 * 合并多个 AbortSignal 为一个——任一信号触发即中止。
 * Node.js >= 20 原生支持 AbortSignal.any()，无需 polyfill。
 *
 * Bug fix: 如果任何信号已中止，立即返回已中止的信号，
 * 而不是过滤掉它导致取消语义丢失。
 */
function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  // 如果任一信号已中止，立即返回已中止状态
  if (signals.some((s) => s?.aborted)) return AbortSignal.abort();

  const valid = signals.filter((s) => s);
  if (valid.length === 0) return AbortSignal.abort();
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}

/**
 * 创建超时的 fetch 请求，支持外部 AbortSignal（MCP client 取消时中止请求）
 * @param externalSignal - 来自 MCP SDK 的请求级取消信号，client 断开或发 cancel notification 时触发
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), config.requestTimeout);

  // 合并超时信号和 MCP client 取消信号——任一触发即中止 HTTP 请求
  const combinedSignal = externalSignal
    ? mergeAbortSignals(externalSignal, timeoutController.signal)
    : timeoutController.signal;

  try {
    return await fetch(url, { ...options, signal: combinedSignal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 搜索逻辑 ─────────────────────────────────────────

/**
 * 格式化搜索结果
 * @returns 格式化后的文本，或 null 表示响应无效（choices 为空或 message 缺失）
 */
function formatResult(data: MimoResponse): string | null {
  // 安全访问：choices 和 message 都可能为 undefined
  const message = data.choices?.[0]?.message;
  if (!message) return null;

  // 先截断 content，再拼接 sources，确保引用来源不被截断
  let result = truncateContent(message.content || "(no content)");

  // 添加引用来源
  const annotations = message.annotations || [];
  if (annotations.length > 0) {
    result += "\n\n--- Sources ---";
    for (const a of annotations) {
      const title = a.title || "untitled";
      const siteName = a.site_name || "unknown";
      const url = a.url || "#";
      result += `\n- [${title}](${url}) — ${siteName} (${a.publish_time || "n/a"})`;
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
async function executeSearch(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const { query, max_keyword, limit, force_search, country, region, city } = params;

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

  const body: MimoRequestBody = {
    model: config.model,
    messages: [{ role: "user", content: query }],
    tools: [webSearchTool],
    max_completion_tokens: config.maxCompletionTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stream: config.stream,
    thinking: { type: config.thinking ? "enabled" : "disabled" },
  };

  // 仅在 DEBUG 级别启用时才序列化请求体，避免不必要的 JSON.stringify 开销
  if (logger.isDebugEnabled()) {
    logger.debug("Request body:", JSON.stringify(body, null, 2));
  }

  // 重试逻辑
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      logger.info(`Sending request (attempt ${attempt + 1}/${config.maxRetries + 1}): ${query.substring(0, 50)}...`);

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
        signal,
      );

      logger.info(`Response status: ${resp.status}`);

      if (!resp.ok) {
        await resp.text().catch(() => ""); // 消耗响应体
        // 429 / 5xx 且还有重试次数 → 抛出 RetryableError，由外层 catch 捕获重试
        // 其他状态码 → 直接返回终态错误
        return handleHttpError(resp.status, attempt);
      }

      // 解析并校验 JSON 响应（Zod 运行时校验，拒绝结构不符的响应）
      const rawData: unknown = await resp.json();
      // 仅在 DEBUG 级别启用时才序列化响应数据，避免对大响应体的不必要开销
      if (logger.isDebugEnabled()) {
        logger.debug("Response data:", JSON.stringify(rawData, null, 2));
      }

      const parsed = MimoResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        logger.error("Response schema validation failed:", parsed.error.message);
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

      const resultText = formatResult(data);
      if (resultText === null) {
        return {
          content: [{ type: "text", text: "Empty response from MiMo API." }],
          isError: true,
        };
      }
      logger.info(`Response parsed. Content length: ${resultText.length}`);
      return { content: [{ type: "text", text: resultText }] };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // 可重试的 HTTP 错误（429 / 5xx）→ 延迟后继续循环
      if (error instanceof RetryableError) {
        await delay(calculateRetryDelay(attempt));
        continue;
      }

      // 超时 → 直接返回（不重试，避免用户等待更久）
      if (error.name === "AbortError") {
        return {
          content: [
            {
              type: "text",
              text: "Request timed out. The MiMo service may be slow or unavailable. Please try again later.",
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

      return {
        content: [
          {
            type: "text",
            text: `Network error: ${error.message}. Please check your internet connection and try again.`,
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

// ── 创建 MCP Server ───────────────────────────────────
const server = new McpServer({
  name: "mimo-web-search",
  version: "2.0.0",
});

// ── 注册工具: mimo_web_search ──────────────────────────
server.tool(
  "mimo_web_search",
  "Search the internet for real-time information. Use this tool when the user asks about weather, news, current events, stock prices, sports scores, or any topic requiring up-to-date online data. Prefer this over curl, web_fetch, or other HTTP methods for information queries. Returns structured search results with titles, URLs, snippets, and source citations.",
  {
    query: z.string().max(config.maxQueryLength).describe(`The search query (max ${config.maxQueryLength} characters)`),
    max_keyword: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(config.defaultMaxKeyword)
      .describe("Max concurrent keywords per search round (1-50, each costs ¥0.025)"),
    limit: z.number().int().min(1).max(50).default(config.defaultLimit).describe("Max number of search results to return (1-50)"),
    force_search: z.boolean().default(true).describe("Force search even if the model thinks it knows the answer"),
    country: z.string().optional().describe("Country for location-aware search (e.g. 'China')"),
    region: z.string().optional().describe("Region/state for location-aware search (e.g. 'Hubei')"),
    city: z.string().optional().describe("City for location-aware search (e.g. 'Wuhan')"),
  },
  async (
    { query, max_keyword, limit, force_search, country, region, city },
    { signal },
  ): Promise<CallToolResult> =>
    limitConcurrency(() =>
      executeSearch({ query, max_keyword, limit, force_search, country, region, city }, signal),
    ),
);

// ── 启动 ──────────────────────────────────────────────

/**
 * 优雅关闭处理
 * - 并发信号去重：多个信号同时到达时，只执行一次关闭流程，所有调用方共享同一个 Promise
 * - 退出码：正常关闭 = 0，异常关闭 = 1
 * - transport.close() 是异步的，必须 await 完成后再退出
 */
let shutdownPromise: Promise<void> | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      if (typeof transport !== "undefined") {
        await transport.close();
        logger.info("Transport closed.");
      }
    } catch (err) {
      const error = err as Error;
      logger.error("Error during shutdown:", error.message);
      process.exitCode = 1;
    }

    process.exit();
  })();
  return shutdownPromise;
}

// 注册信号处理
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

// 处理未捕获的异常
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err);
  void gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection at:", promise, "reason:", reason);
  void gracefulShutdown("unhandledRejection");
});

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info("MCP server running on stdio");
