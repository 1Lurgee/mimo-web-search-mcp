#!/usr/bin/env node
/**
 * 配置模块测试
 * 测试 config.ts 的功能和错误处理
 */

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { test, assert, assertEqual, assertThrows, suite, printResults } from "./test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// 将路径转换为 file:// URL（Windows 兼容）
function toFileURL(filePath) {
  return pathToFileURL(filePath).href;
}

async function runTests() {
  console.log("\n🧪 配置模块测试\n");

  suite("配置加载 - 环境变量验证");

  await test("缺少 MIMO_API_KEY 时抛出错误", () => {
    const original = process.env.MIMO_API_KEY;
    delete process.env.MIMO_API_KEY;
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((module) => {
        assertThrows(() => module.loadConfig(), "MIMO_API_KEY");
      })
      .finally(() => {
        if (original) process.env.MIMO_API_KEY = original;
      });
  });

  await test("无效 URL 时抛出错误", () => {
    const originalKey = process.env.MIMO_API_KEY;
    const originalUrl = process.env.MIMO_BASE_URL;
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_BASE_URL = "invalid-url";
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((module) => {
        assertThrows(() => module.loadConfig(), "Invalid MIMO_BASE_URL");
      })
      .finally(() => {
        if (originalKey) process.env.MIMO_API_KEY = originalKey;
        else delete process.env.MIMO_API_KEY;
        if (originalUrl) process.env.MIMO_BASE_URL = originalUrl;
        else delete process.env.MIMO_BASE_URL;
      });
  });

  await test("空字符串 API Key 抛出错误", () => {
    const original = process.env.MIMO_API_KEY;
    process.env.MIMO_API_KEY = "";
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((module) => {
        assertThrows(() => module.loadConfig(), "MIMO_API_KEY");
      })
      .finally(() => {
        if (original) process.env.MIMO_API_KEY = original;
        else delete process.env.MIMO_API_KEY;
      });
  });

  suite("配置加载 - 默认值");

  await test("使用默认值", () => {
    process.env.MIMO_API_KEY = "test-key";
    delete process.env.MIMO_BASE_URL;
    delete process.env.REQUEST_TIMEOUT;
    delete process.env.DEBUG;
    return import(toFileURL(join(rootDir, "dist/config.js"))).then((module) => {
      const config = module.loadConfig();
      assertEqual(config.apiKey, "test-key");
      assertEqual(config.baseUrl, "https://api.xiaomimimo.com/v1");
      assertEqual(config.requestTimeout, 60000);
      assertEqual(config.maxRetries, 2);
      assertEqual(config.maxConcurrent, 10);
      assertEqual(config.maxContentLength, 100000);
    });
  });

  await test("自定义环境变量", () => {
    const originalKey = process.env.MIMO_API_KEY;
    const originalUrl = process.env.MIMO_BASE_URL;
    const originalTimeout = process.env.REQUEST_TIMEOUT;
    const originalDebug = process.env.DEBUG;

    process.env.MIMO_API_KEY = "custom-key";
    process.env.MIMO_BASE_URL = "https://custom.api.com/v1/";
    process.env.REQUEST_TIMEOUT = "30000";
    process.env.DEBUG = "2";
    return import(toFileURL(join(rootDir, "dist/config.js"))).then((module) => {
      const config = module.loadConfig();
      assertEqual(config.apiKey, "custom-key");
      assertEqual(config.baseUrl, "https://custom.api.com/v1"); // 应该去除尾部斜杠
      assertEqual(config.requestTimeout, 30000);
      assertEqual(config.logLevel, 3); // DEBUG level = 3
    }).finally(() => {
      // 恢复原始环境变量
      if (originalKey) process.env.MIMO_API_KEY = originalKey;
      else delete process.env.MIMO_API_KEY;
      if (originalUrl) process.env.MIMO_BASE_URL = originalUrl;
      else delete process.env.MIMO_BASE_URL;
      if (originalTimeout) process.env.REQUEST_TIMEOUT = originalTimeout;
      else delete process.env.REQUEST_TIMEOUT;
      if (originalDebug) process.env.DEBUG = originalDebug;
      else delete process.env.DEBUG;
    });
  });

  return printResults();
}

export { runTests };

// 直接运行时执行测试
runTests().catch((err) => {
  console.error("测试运行失败:", err);
  process.exit(1);
});
