#!/usr/bin/env node
/**
 * 代码质量测试
 * 测试代码结构、配置完整性和编译输出
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";
import { test, assert, assertEqual, assertContains, suite, printResults } from "./test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

async function runTests() {
  console.log("\n🧪 代码质量测试\n");

  suite("代码结构");

  await test("源文件存在", () => {
    const files = ["src/index.ts", "src/config.ts", "src/logger.ts", "src/types.ts"];
    for (const file of files) {
      assert(existsSync(join(rootDir, file)), `${file} should exist`);
    }
  });

  await test("编译输出存在", () => {
    const files = ["dist/index.js", "dist/config.js", "dist/logger.js", "dist/types.js"];
    for (const file of files) {
      assert(existsSync(join(rootDir, file)), `${file} should exist`);
    }
  });

  await test("配置文件完整", () => {
    assert(existsSync(join(rootDir, "tsconfig.json")), "tsconfig.json should exist");
    assert(existsSync(join(rootDir, "eslint.config.js")), "eslint.config.js should exist");
    assert(existsSync(join(rootDir, "package.json")), "package.json should exist");
  });

  suite("package.json 配置");

  await test("package.json 结构正确", () => {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));

    assertEqual(pkg.type, "module", "Should be ESM module");
    assertEqual(pkg.main, "dist/index.js", "Main should point to dist");
    assert(pkg.bin, "Should have bin field");
    assertEqual(pkg.bin["mimo-web-search"], "dist/index.js");
    assert(pkg.engines, "Should have engines field");
    assert(pkg.scripts.build, "Should have build script");
    assert(pkg.scripts.dev, "Should have dev script");
    assert(pkg.scripts.start, "Should have start script");
    assert(pkg.scripts.test, "Should have test script");
  });

  await test("依赖完整", () => {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));

    assert(pkg.dependencies["@modelcontextprotocol/sdk"], "Should have MCP SDK");
    assert(pkg.dependencies["zod"], "Should have zod");
    assert(pkg.devDependencies["typescript"], "Should have TypeScript");
    assert(pkg.devDependencies["tsx"], "Should have tsx");
    assert(pkg.devDependencies["eslint"], "Should have ESLint");
  });

  suite("TypeScript 配置");

  await test("tsconfig.json 配置正确", () => {
    const tsconfig = JSON.parse(readFileSync(join(rootDir, "tsconfig.json"), "utf-8"));

    assertEqual(tsconfig.compilerOptions.target, "ES2022");
    assertEqual(tsconfig.compilerOptions.module, "Node16");
    assertEqual(tsconfig.compilerOptions.moduleResolution, "Node16");
    assertEqual(tsconfig.compilerOptions.strict, true);
    assertEqual(tsconfig.compilerOptions.outDir, "./dist");
    assertEqual(tsconfig.compilerOptions.rootDir, "./src");
    assert(tsconfig.include.includes("src/**/*"));
    assert(tsconfig.exclude.includes("node_modules"));
    assert(tsconfig.exclude.includes("dist"));
  });

  suite("源代码质量");

  await test("index.ts 包含必要导入", () => {
    const content = readFileSync(join(rootDir, "src/index.ts"), "utf-8");

    assertContains(content, 'from "@modelcontextprotocol/sdk/server/mcp.js"');
    assertContains(content, 'from "@modelcontextprotocol/sdk/server/stdio.js"');
    assertContains(content, 'from "zod"');
    assertContains(content, 'from "./config.js"');
    assertContains(content, 'from "./logger.js"');
    assertContains(content, 'from "./types.js"');
  });

  await test("index.ts 包含 MCP 工具注册", () => {
    const content = readFileSync(join(rootDir, "src/index.ts"), "utf-8");

    assertContains(content, 'mimo_web_search');
    assertContains(content, 'query: z.string');
    assertContains(content, 'max_keyword: z');
    assertContains(content, 'limit: z.number');
    assertContains(content, 'force_search: z.boolean');
  });

  await test("index.ts 包含错误处理", () => {
    const content = readFileSync(join(rootDir, "src/index.ts"), "utf-8");

    assertContains(content, 'try {');
    assertContains(content, 'catch');
    assertContains(content, 'isError: true');
    assertContains(content, 'AbortError');
    assertContains(content, 'ECONNRESET');
    assertContains(content, 'ENOTFOUND');
    assertContains(content, 'ECONNREFUSED');
  });

  await test("index.ts 包含重试逻辑", () => {
    const content = readFileSync(join(rootDir, "src/index.ts"), "utf-8");

    assertContains(content, 'maxRetries');
    assertContains(content, 'retryDelay');
    assertContains(content, 'for (let attempt = 0;');
  });

  await test("index.ts 包含并发控制", () => {
    const content = readFileSync(join(rootDir, "src/index.ts"), "utf-8");

    assertContains(content, 'activeRequests');
    assertContains(content, 'maxConcurrent');
    assertContains(content, 'activeRequests++');
    assertContains(content, 'activeRequests--');
  });

  await test("index.ts 包含优雅关闭", () => {
    const content = readFileSync(join(rootDir, "src/index.ts"), "utf-8");

    assertContains(content, 'gracefulShutdown');
    assertContains(content, 'SIGINT');
    assertContains(content, 'SIGTERM');
    assertContains(content, 'uncaughtException');
    assertContains(content, 'unhandledRejection');
  });

  await test("config.ts 包含配置验证", () => {
    const content = readFileSync(join(rootDir, "src/config.ts"), "utf-8");

    assertContains(content, 'MIMO_API_KEY');
    assertContains(content, 'MIMO_BASE_URL');
    assertContains(content, 'validateUrl');
    assertContains(content, 'loadConfig');
  });

  await test("logger.ts 包含日志级别", () => {
    const content = readFileSync(join(rootDir, "src/logger.ts"), "utf-8");

    assertContains(content, 'LogLevel.ERROR');
    assertContains(content, 'LogLevel.WARN');
    assertContains(content, 'LogLevel.INFO');
    assertContains(content, 'LogLevel.DEBUG');
    assertContains(content, 'createLogger');
  });

  await test("types.ts 包含类型定义", () => {
    const content = readFileSync(join(rootDir, "src/types.ts"), "utf-8");

    assertContains(content, 'interface Annotation');
    assertContains(content, 'interface WebSearchUsage');
    assertContains(content, 'interface Usage');
    assertContains(content, 'interface Message');
    assertContains(content, 'interface Choice');
    assertContains(content, 'interface MimoResponse');
    assertContains(content, 'interface WebSearchToolConfig');
    assertContains(content, 'interface UserLocation');
    assertContains(content, 'interface MimoRequestBody');
    assertContains(content, 'interface SearchParams');
  });

  suite("编译输出质量");

  await test("编译输出包含 shebang", () => {
    const content = readFileSync(join(rootDir, "dist/index.js"), "utf-8");
    assertContains(content, '#!/usr/bin/env node');
  });

  await test("编译输出是 ESM 格式", () => {
    const content = readFileSync(join(rootDir, "dist/index.js"), "utf-8");
    assert(
      content.includes('import {') || content.includes('import('),
      "Should contain ESM import statements"
    );
  });

  await test("类型声明文件完整", () => {
    const files = ["dist/index.d.ts", "dist/config.d.ts", "dist/logger.d.ts", "dist/types.d.ts"];
    for (const file of files) {
      assert(existsSync(join(rootDir, file)), `${file} should exist`);
    }
  });

  suite("关键功能存在");

  await test("截断函数存在", () => {
    const content = readFileSync(join(rootDir, "dist/index.js"), "utf-8");
    assertContains(content, 'truncateContent');
  });

  await test("延迟函数存在", () => {
    const content = readFileSync(join(rootDir, "dist/index.js"), "utf-8");
    assertContains(content, 'function delay');
  });

  await test("超时 fetch 存在", () => {
    const content = readFileSync(join(rootDir, "dist/index.js"), "utf-8");
    assertContains(content, 'fetchWithTimeout');
    assertContains(content, 'AbortController');
  });

  return printResults();
}

export { runTests };

// 直接运行时执行测试
runTests().catch((err) => {
  console.error("测试运行失败:", err);
  process.exit(1);
});
