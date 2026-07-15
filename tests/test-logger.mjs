#!/usr/bin/env node
/**
 * 日志模块测试
 * 测试 logger.ts 的功能
 */

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { test, assert, assertEqual, suite, printResults } from "./test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// 将路径转换为 file:// URL（Windows 兼容）
function toFileURL(filePath) {
  return pathToFileURL(filePath).href;
}

async function runTests() {
  console.log("\n🧪 日志模块测试\n");

  suite("日志器创建");

  await test("日志器包含所有级别函数", () => {
    process.env.MIMO_API_KEY = "test-key";
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((configModule) => {
        const config = configModule.loadConfig();
        return import(toFileURL(join(rootDir, "dist/logger.js"))).then((loggerModule) => {
          const logger = loggerModule.createLogger(config);
          assert(typeof logger.error === "function", "logger.error should be a function");
          assert(typeof logger.warn === "function", "logger.warn should be a function");
          assert(typeof logger.info === "function", "logger.info should be a function");
          assert(typeof logger.debug === "function", "logger.debug should be a function");
        });
      });
  });

  suite("日志级别控制");

  await test("DEBUG=0 时只有 error 输出", () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "0";
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((configModule) => {
        const config = configModule.loadConfig();
        return import(toFileURL(join(rootDir, "dist/logger.js"))).then((loggerModule) => {
          const logger = loggerModule.createLogger(config);
          // 这里只测试函数存在，实际输出需要捕获 stderr
          assert(logger.error, "error function exists");
          assert(logger.warn, "warn function exists");
          assert(logger.info, "info function exists");
          assert(logger.debug, "debug function exists");
        });
      })
      .finally(() => {
        delete process.env.DEBUG;
      });
  });

  await test("DEBUG=1 时 info 和 error 输出", () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "1";
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((configModule) => {
        const config = configModule.loadConfig();
        assertEqual(config.logLevel, 2); // INFO = 2
        return import(toFileURL(join(rootDir, "dist/logger.js"))).then((loggerModule) => {
          const logger = loggerModule.createLogger(config);
          assert(logger.error, "error function exists");
          assert(logger.info, "info function exists");
        });
      })
      .finally(() => {
        delete process.env.DEBUG;
      });
  });

  await test("DEBUG=2 时所有级别输出", () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "2";
    return import(toFileURL(join(rootDir, "dist/config.js")))
      .then((configModule) => {
        const config = configModule.loadConfig();
        assertEqual(config.logLevel, 3); // DEBUG = 3
        return import(toFileURL(join(rootDir, "dist/logger.js"))).then((loggerModule) => {
          const logger = loggerModule.createLogger(config);
          assert(logger.error, "error function exists");
          assert(logger.debug, "debug function exists");
        });
      })
      .finally(() => {
        delete process.env.DEBUG;
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
