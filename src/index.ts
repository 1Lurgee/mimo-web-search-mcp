#!/usr/bin/env node
/** MiMo Web Search MCP Server
 *  Wraps Xiaomi MiMo's web_search API as an MCP tool for Claude Code.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";

// ── 初始化 ────────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);
const server = createServer();

// ── 优雅关闭 ──────────────────────────────────────────

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

// ── 启动 ──────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info("MCP server running on stdio");
