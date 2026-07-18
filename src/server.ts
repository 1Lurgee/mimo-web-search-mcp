/** MCP 协议接入层 - 工具注册与服务器创建 */

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pLimit from "p-limit";
import { loadConfig } from "./config.js";
import { executeSearch } from "./search.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** 创建并配置 MCP Server（注册所有工具） */
export function createServer(): McpServer {
  const config = loadConfig();
  const limitConcurrency = pLimit(config.maxConcurrent);

  const server = new McpServer({
    name: "mimo-web-search",
    version: "2.1.0",
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
    ): Promise<CallToolResult> => {
      const reqId = randomUUID().slice(0, 8);
      return limitConcurrency(() =>
        executeSearch({ query, max_keyword, limit, force_search, country, region, city }, signal, reqId),
      );
    },
  );

  return server;
}
