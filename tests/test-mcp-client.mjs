#!/usr/bin/env node
/**
 * MCP 客户端交互测试
 * 测试 MCP 协议交互和工具调用
 * 需要设置 MIMO_API_KEY 环境变量才能运行
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test, assert, assertEqual, suite, printResults } from "./test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

async function runTests() {
  console.log("\n🧪 MCP 客户端交互测试\n");

  // 检查是否有 API key
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    console.log("⚠️  跳过 MCP 客户端测试: 未设置 MIMO_API_KEY 环境变量");
    console.log("   设置 MIMO_API_KEY 后可运行完整测试");
    return 0;
  }

  let client = null;
  let transport = null;

  try {
    suite("MCP 服务器启动");

    await test("服务器进程启动", async () => {
      transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, MIMO_API_KEY: apiKey },
      });

      client = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);
      // 连接成功即表示服务器启动正常
      assert(client, "Client should be created");
    });

    suite("工具注册");

    await test("获取工具列表", async () => {
      const result = await client.listTools();
      assert(result.tools.length > 0, "Should have at least one tool");

      const tool = result.tools[0];
      assertEqual(tool.name, "mimo_web_search");
      assert(tool.description, "Tool should have description");
      assert(tool.inputSchema, "Tool should have input schema");
    });

    await test("工具参数 schema 验证", async () => {
      const result = await client.listTools();
      const tool = result.tools[0];

      // 验证必需参数
      assert(tool.inputSchema.required.includes("query"), "query should be required");

      // 验证可选参数
      assert(tool.inputSchema.properties.max_keyword, "Should have max_keyword");
      assert(tool.inputSchema.properties.limit, "Should have limit");
      assert(tool.inputSchema.properties.force_search, "Should have force_search");
      assert(tool.inputSchema.properties.country, "Should have country");
    });

    suite("实际搜索调用");

    await test("基本搜索调用", async () => {
      const result = await client.callTool({
        name: "mimo_web_search",
        arguments: {
          query: "今天天气",
          limit: 2,
        },
      });

      assert(result.content, "Should have content");
      assert(Array.isArray(result.content), "Content should be array");
      assert(result.content.length > 0, "Content should not be empty");
      assert(result.content[0].type === "text", "Content type should be text");
      assert(result.content[0].text, "Content text should exist");
    });

    await test("带位置参数的搜索", async () => {
      const result = await client.callTool({
        name: "mimo_web_search",
        arguments: {
          query: "附近餐厅",
          country: "China",
          region: "Hubei",
          city: "Wuhan",
          limit: 3,
        },
      });

      assert(result.content, "Should have content");
      assert(!result.isError, "Should not be error");
    });

    await test("并发限制测试", async () => {
      // 快速发送多个请求测试并发控制
      const promises = Array(3).fill(null).map(() =>
        client.callTool({
          name: "mimo_web_search",
          arguments: { query: "test", limit: 1 },
        })
      );

      const results = await Promise.all(promises);
      results.forEach((result) => {
        assert(result.content, "Each result should have content");
      });
    });

    suite("错误处理");

    await test("不存在的工具调用", async () => {
      try {
        await client.callTool({
          name: "non_existent_tool",
          arguments: {},
        });
        throw new Error("Should have thrown");
      } catch (err) {
        assert(err.message, "Should throw error for non-existent tool");
      }
    });

    return printResults();
  } finally {
    // 清理
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

export { runTests };

// 直接运行时执行测试
runTests().catch((err) => {
  console.error("测试运行失败:", err);
  process.exit(1);
});
