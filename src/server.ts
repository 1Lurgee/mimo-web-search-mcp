/** MCP 协议接入层 - 工具注册与服务器创建 */

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pLimit from "p-limit";
import { loadConfig } from "./config.js";
import { executeSearch } from "./search.js";
import { executeFetch } from "./fetch-tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { globalFetchCache } from "./cache.js";

/** 创建并配置 MCP Server（注册所有工具） */
export function createServer(): McpServer {
  const config = loadConfig();
  const limitConcurrency = pLimit(config.maxConcurrent);

  const server = new McpServer({
    name: "mimo-web-search",
    version: "3.0.0",
  });

  // ── 工具 annotations（MCP 规范，帮助 client 理解工具语义）──
  const toolAnnotations = {
    readOnlyHint: true as const,
    openWorldHint: true as const,
    destructiveHint: false as const,
    idempotentHint: true as const,
  };

  // ── 注册工具: mimo_web_search ──────────────────────────
  server.tool(
    "mimo_web_search",
    "Search the internet for real-time information. Use this tool when the user asks about weather, news, current events, stock prices, sports scores, or any topic requiring up-to-date online data. Use mimo_web_fetch instead when the user provides a specific URL and wants to read the full page content. Returns structured search results with titles, URLs, snippets, and source citations.",
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
      allowed_domains: z
        .array(z.string())
        .optional()
        .describe("Optional list of domains to restrict search results to (e.g. ['docs.rs', 'github.com'])"),
    },
    toolAnnotations,
    async (
      { query, max_keyword, limit, force_search, country, region, city, allowed_domains },
      { signal },
    ): Promise<CallToolResult> => {
      const reqId = randomUUID().slice(0, 8);
      return limitConcurrency(() =>
        executeSearch({ query, max_keyword, limit, force_search, country, region, city, allowed_domains }, signal, reqId),
      );
    },
  );

  // ── 注册工具: mimo_web_fetch ────────────────────────────
  server.tool(
    "mimo_web_fetch",
    "Fetch web page content and convert to Markdown. MUST use this tool (not mimo_web_search) when the user provides a specific URL and wants to read its content. Also use when the user asks to read, fetch, or extract content from a known web page. Supports optional AI processing via prompt parameter. Returns structured Markdown with metadata. Note: Does not support JavaScript-rendered SPA pages.",
    {
      url: z.string().url().describe("The URL to fetch (http/https only)"),
      prompt: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Optional prompt for AI processing of the content. When provided, MiMo will analyze the page content according to this prompt.",
        ),
      clean: z
        .boolean()
        .default(true)
        .describe("Extract main content using Readability (removes nav, ads, sidebars). Set to false to get full page content."),
      max_length: z
        .number()
        .int()
        .min(1000)
        .max(500000)
        .default(50000)
        .describe("Maximum characters to return (1000-500000)"),
    },
    toolAnnotations,
    async (
      { url, prompt, clean, max_length },
      { signal },
    ): Promise<CallToolResult> => {
      const reqId = randomUUID().slice(0, 8);
      return limitConcurrency(() =>
        executeFetch({ url, prompt, clean, maxLength: max_length }, signal, reqId),
      );
    },
  );

  // ── 注册工具: mimo_cache_stats ──────────────────────────
  server.tool(
    "mimo_cache_stats",
    "Get cache statistics for web fetch operations. Returns cache size and configuration.",
    {},
    toolAnnotations,
    async (): Promise<CallToolResult> => {
      const stats = globalFetchCache.stats();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );

  // ── 注册工具: mimo_cache_clear ──────────────────────────
  server.tool(
    "mimo_cache_clear",
    "Clear the web fetch cache. Useful when you need fresh content from a previously fetched URL.",
    {},
    toolAnnotations,
    async (): Promise<CallToolResult> => {
      globalFetchCache.clear();
      return {
        content: [{ type: "text", text: "Cache cleared successfully." }],
      };
    },
  );

  return server;
}
