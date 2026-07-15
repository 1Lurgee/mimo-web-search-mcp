#!/usr/bin/env node
/**
 * 统一测试入口
 * 运行所有测试套件
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 测试套件列表
const testSuites = [
  { name: "代码质量", script: "test-code-quality.mjs" },
  { name: "配置模块", script: "test-config.mjs" },
  { name: "日志模块", script: "test-logger.mjs" },
  { name: "MCP 客户端", script: "test-mcp-client.mjs" },
];

function runAllTests() {
  console.log("🚀 开始运行所有测试套件\n");
  console.log("=".repeat(60));

  let totalPassed = 0;
  let totalFailed = 0;
  const failedSuites = [];

  for (const suite of testSuites) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📋 运行测试套件: ${suite.name}`);
    console.log(`${"=".repeat(60)}`);

    try {
      const scriptPath = join(__dirname, suite.script);
      execSync(`node "${scriptPath}"`, {
        stdio: "inherit",
        cwd: join(__dirname, ".."),
      });
      totalPassed++;
    } catch (err) {
      console.error(`❌ 测试套件 ${suite.name} 失败`);
      failedSuites.push(suite.name);
      totalFailed++;
    }
  }

  // 打印总结
  console.log("\n" + "=".repeat(60));
  console.log("📊 测试套件总结");
  console.log("=".repeat(60));
  console.log(`\n总计: ${testSuites.length} 个测试套件`);
  console.log(`✅ 通过: ${totalPassed} 个`);
  console.log(`❌ 失败: ${totalFailed} 个`);

  if (failedSuites.length > 0) {
    console.log(`\n失败的套件:`);
    failedSuites.forEach((name) => console.log(`  - ${name}`));
  }

  console.log("\n" + "=".repeat(60));

  if (totalFailed > 0) {
    console.log("❌ 部分测试失败");
    process.exit(1);
  } else {
    console.log("✅ 所有测试套件通过!");
    process.exit(0);
  }
}

// 运行所有测试
runAllTests();
