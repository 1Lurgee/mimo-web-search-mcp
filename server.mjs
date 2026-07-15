#!/usr/bin/env node
// MiMo Web Search MCP Server
// Wraps Xiaomi MiMo's web_search API as an MCP tool for Claude Code.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── 配置 ──────────────────────────────────────────────
const MIMO_API_KEY = process.env.MIMO_API_KEY;
const MIMO_BASE_URL = (
  process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1"
).replace(/\/+$/, "");

// 验证必需的环境变量
if (!MIMO_API_KEY) {
  console.error("[mimo-web-search] Error: MIMO_API_KEY environment variable is required.");
  process.exit(1);
}

// 验证 URL 格式
function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

if (!validateUrl(MIMO_BASE_URL)) {
  console.error(`[mimo-web-search] Error: Invalid MIMO_BASE_URL format: ${MIMO_BASE_URL}`);
  process.exit(1);
}

// 请求超时配置（毫秒）
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 30000;

// 重试配置
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

// 响应大小限制
const MAX_CONTENT_LENGTH = 100000; // 100KB

// 并发控制
let activeRequests = 0;
const MAX_CONCURRENT = 10;

// ── 创建 MCP Server ───────────────────────────────────
const server = new McpServer({
  name: "mimo-web-search",
  version: "1.0.0",
});

// 内容清洗函数 - 防止提示词注入
function sanitizeContent(text) {
  if (!text || typeof text !== "string") return text;

  // 移除常见的提示词注入模式
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /ignore\s+(all\s+)?above\s+instructions/gi,
    /disregard\s+(all\s+)?previous/gi,
    /system:\s*/gi,
    /assistant:\s*/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<<SYS>>/gi,
    /<\/SYS>>/gi,
  ];

  let sanitized = text;
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, "[FILTERED]");
  }

  return sanitized;
}

// 截断过长内容
function truncateContent(text, maxLength = MAX_CONTENT_LENGTH) {
  if (!text || typeof text !== "string") return text;
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "\n\n[Content truncated due to size limit...]";
}

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
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5)
      .describe("Max number of search results to return (1-50)"),
    force_search: z
      .boolean()
      .default(true)
      .describe("Force search even if the model thinks it knows the answer"),
    country: z.string().optional().describe("Country for location-aware search (e.g. 'China')"),
    region: z.string().optional().describe("Region/state for location-aware search (e.g. 'Hubei')"),
    city: z.string().optional().describe("City for location-aware search (e.g. 'Wuhan')"),
  },
  async ({ query, max_keyword, limit, force_search, country, region, city }) => {
    // 并发控制检查
    if (activeRequests >= MAX_CONCURRENT) {
      return {
        content: [{ type: "text", text: "Too many concurrent requests. Please try again later." }],
        isError: true,
      };
    }
    activeRequests++;

    try {
      // 构造 web_search tool 配置
    const webSearchTool = {
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

    const body = {
      model: "mimo-v2.5-pro",
      messages: [{ role: "user", content: query }],
      tools: [webSearchTool],
      max_completion_tokens: 1024,
      temperature: 0.2,
      top_p: 0.95,
      stream: false,
      thinking: { type: "disabled" },
    };

    // 重试逻辑
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 创建超时控制器
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        const resp = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "api-key": MIMO_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          // 分类处理 HTTP 错误
          if (resp.status === 401 || resp.status === 403) {
            return {
              content: [{ type: "text", text: "Authentication failed. Please check your MIMO_API_KEY." }],
              isError: true,
            };
          } else if (resp.status === 429) {
            if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
              continue;
            }
            return {
              content: [{ type: "text", text: "Rate limit exceeded. Please try again later." }],
              isError: true,
            };
          } else if (resp.status >= 500) {
            if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
              continue;
            }
            return {
              content: [{ type: "text", text: `MiMo service temporarily unavailable (HTTP ${resp.status}). Please try again later.` }],
              isError: true,
            };
          } else {
            return {
              content: [{ type: "text", text: `Request failed with HTTP ${resp.status}. Please check your query parameters.` }],
              isError: true,
            };
          }
        }

        const data = await resp.json();

        // 验证响应结构
        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
          return {
            content: [{ type: "text", text: "No response received from MiMo API. The service may be temporarily unavailable." }],
            isError: true,
          };
        }

        const message = data.choices[0]?.message;
        if (!message) {
          return {
            content: [{ type: "text", text: "Invalid response format from MiMo API. Please try again." }],
            isError: true,
          };
        }

        const content = message.content || "(no content)";
        const annotations = message.annotations || [];
        const usage = data.usage || {};

        // 应用内容清洗和截断
        const sanitizedContent = sanitizeContent(content);
        const truncatedContent = truncateContent(sanitizedContent);

        // 格式化输出
        let result = truncatedContent;

        if (annotations.length > 0) {
          result += "\n\n--- Sources ---";
          for (const a of annotations) {
            const title = sanitizeContent(a.title || "untitled");
            const siteName = sanitizeContent(a.site_name || "unknown");
            result += `\n- [${title}](${a.url}) — ${siteName} (${a.publish_time || "n/a"})`;
          }
        }

        const searchUsage = usage.web_search_usage || {};
        result += `\n\n--- Usage ---`;
        result += `\nSearch calls: ${searchUsage.tool_usage || 0}, Pages: ${searchUsage.page_usage || 0}`;
        result += `\nTokens: ${usage.total_tokens || 0} (prompt: ${usage.prompt_tokens || 0}, completion: ${usage.completion_tokens || 0})`;

        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        // 处理超时和网络错误
        if (err.name === "AbortError") {
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          return {
            content: [{ type: "text", text: "Request timed out. The MiMo service may be slow or unavailable. Please try again later." }],
            isError: true,
          };
        }

        // 网络错误重试
        if (attempt < MAX_RETRIES && (err.code === "ECONNRESET" || err.code === "ENOTFOUND" || err.code === "ECONNREFUSED")) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
          continue;
        }

        return {
          content: [{ type: "text", text: `Network error: ${err.message}. Please check your internet connection and try again.` }],
          isError: true,
        };
      }
    }
    } finally {
      activeRequests--;
    }
  },
);

// ── 启动 ──────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mimo-web-search] MCP server running on stdio");

// 优雅关闭处理
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(`[mimo-web-search] Received ${signal}, shutting down gracefully...`);

  try {
    // 关闭传输层
    await transport.close();
    console.error("[mimo-web-search] Transport closed.");
  } catch (err) {
    console.error("[mimo-web-search] Error during shutdown:", err.message);
  }

  process.exit(0);
}

// 注册信号处理
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 处理未捕获的异常
process.on("uncaughtException", (err) => {
  console.error("[mimo-web-search] Uncaught exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[mimo-web-search] Unhandled rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});
