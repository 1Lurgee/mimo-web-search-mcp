#!/usr/bin/env node
/** MiMo Web Search MCP Server
 *  Wraps Xiaomi MiMo's web_search API as an MCP tool for Claude Code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import type {
  MimoRequestBody,
  MimoResponse,
  SearchParams,
  WebSearchToolConfig,
} from "./types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ── 加载配置 ─────────────────────────────────────────
const config = loadConfig();
const logger = createLogger(config);

// ── 并发控制 ─────────────────────────────────────────
let activeRequests = 0;

// ── 辅助函数 ─────────────────────────────────────────

/** 截断过长内容 */
function truncateContent(text: string): string {
  if (!text || typeof text !== "string") return text;
  if (text.length <= config.maxContentLength) return text;
  return text.substring(0, config.maxContentLength) + "\n\n[Content truncated due to size limit...]";
}

/** 延迟指定毫秒 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 创建超时的 fetch 请求 */
async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 搜索逻辑 ─────────────────────────────────────────

/** 格式化搜索结果 */
function formatResult(data: MimoResponse): string {
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("Invalid response format from MiMo API.");
  }

  let result = message.content || "(no content)";
  result = truncateContent(result);

  // 添加引用来源
  const annotations = message.annotations || [];
  if (annotations.length > 0) {
    result += "\n\n--- Sources ---";
    for (const a of annotations) {
      const title = a.title || "untitled";
      const siteName = a.site_name || "unknown";
      result += `\n- [${title}](${a.url}) — ${siteName} (${a.publish_time || "n/a"})`;
    }
  }

  // 添加使用统计
  const usage = data.usage || {};
  const searchUsage = usage.web_search_usage || {};
  result += `\n\n--- Usage ---`;
  result += `\nSearch calls: ${searchUsage.tool_usage || 0}, Pages: ${searchUsage.page_usage || 0}`;
  result += `\nTokens: ${usage.total_tokens || 0} (prompt: ${usage.prompt_tokens || 0}, completion: ${usage.completion_tokens || 0})`;

  return result;
}

/** 处理 HTTP 错误响应 */
function handleHttpError(status: number, attempt: number): CallToolResult | null {
  if (status === 401 || status === 403) {
    return {
      content: [{ type: "text", text: "Authentication failed. Please check your MIMO_API_KEY." }],
      isError: true,
    };
  }

  if (status === 429) {
    if (attempt < config.maxRetries) return null; // 需要重试
    return {
      content: [{ type: "text", text: "Rate limit exceeded. Please try again later." }],
      isError: true,
    };
  }

  if (status >= 500) {
    if (attempt < config.maxRetries) return null; // 需要重试
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
async function executeSearch(params: SearchParams): Promise<CallToolResult> {
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
    model: "mimo-v2.5-pro",
    messages: [{ role: "user", content: query }],
    tools: [webSearchTool],
    max_completion_tokens: config.maxCompletionTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stream: false,
    thinking: { type: "disabled" },
  };

  logger.debug("Request body:", JSON.stringify(body, null, 2));

  // 重试逻辑
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      logger.info(`Sending request (attempt ${attempt + 1}/${config.maxRetries + 1}): ${query.substring(0, 50)}...`);

      const resp = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      logger.info(`Response status: ${resp.status}`);

      if (!resp.ok) {
        await resp.text().catch(() => ""); // 消耗响应体
        const errorResult = handleHttpError(resp.status, attempt);
        if (errorResult) return errorResult;
        // 需要重试
        await delay(config.retryDelay * (attempt + 1));
        continue;
      }

      // 解析 JSON 响应
      const data = (await resp.json()) as MimoResponse;
      logger.debug("Response data:", JSON.stringify(data, null, 2));

      // 验证响应结构
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
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

      try {
        const resultText = formatResult(data);
        logger.info(`Response parsed. Content length: ${resultText.length}`);
        return { content: [{ type: "text", text: resultText }] };
      } catch {
        return {
          content: [{ type: "text", text: "Invalid response format from MiMo API. Please try again." }],
          isError: true,
        };
      }
    } catch (err) {
      const error = err as Error & { name?: string };

      // 处理超时
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

      // 网络错误重试（仅对可恢复的网络错误重试）
      const nodeError = err as NodeJS.ErrnoException;
      if (
        attempt < config.maxRetries &&
        (nodeError.code === "ECONNRESET" || nodeError.code === "ENOTFOUND" || nodeError.code === "ECONNREFUSED")
      ) {
        await delay(config.retryDelay * (attempt + 1));
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
  version: "1.0.0",
});

// ── 注册工具: mimo_web_search ──────────────────────────
server.tool(
  "mimo_web_search",
  "Search the internet for real-time information. Use this tool when the user asks about weather, news, current events, stock prices, sports scores, or any topic requiring up-to-date online data. Prefer this over curl, web_fetch, or other HTTP methods for information queries. Returns structured search results with titles, URLs, snippets, and source citations.",
  {
    query: z.string().max(10000).describe("The search query (max 10000 characters)"),
    max_keyword: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(3)
      .describe("Max concurrent keywords per search round (1-50, each costs ¥0.025)"),
    limit: z.number().int().min(1).max(50).default(5).describe("Max number of search results to return (1-50)"),
    force_search: z.boolean().default(true).describe("Force search even if the model thinks it knows the answer"),
    country: z.string().optional().describe("Country for location-aware search (e.g. 'China')"),
    region: z.string().optional().describe("Region/state for location-aware search (e.g. 'Hubei')"),
    city: z.string().optional().describe("City for location-aware search (e.g. 'Wuhan')"),
  },
  async ({ query, max_keyword, limit, force_search, country, region, city }): Promise<CallToolResult> => {
    // 并发控制检查
    if (activeRequests >= config.maxConcurrent) {
      return {
        content: [{ type: "text", text: "Too many concurrent requests. Please try again later." }],
        isError: true,
      };
    }
    activeRequests++;

    try {
      return await executeSearch({
        query,
        max_keyword,
        limit,
        force_search,
        country,
        region,
        city,
      });
    } finally {
      activeRequests--;
    }
  },
);

// ── 启动 ──────────────────────────────────────────────

/** 优雅关闭处理 */
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    await transport.close();
    logger.info("Transport closed.");
  } catch (err) {
    const error = err as Error;
    logger.error("Error during shutdown:", error.message);
  }

  process.exit(0);
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
