import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 保存原始环境变量
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const key of keys) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("loadConfig", () => {
  beforeEach(() => {
    saveEnv(
      "MIMO_API_KEY", "MIMO_BASE_URL", "MIMO_MODEL", "REQUEST_TIMEOUT",
      "MAX_COMPLETION_TOKENS", "TEMPERATURE", "TOP_P", "MIMO_STREAM",
      "MIMO_THINKING", "DEBUG", "MAX_RETRIES", "RETRY_DELAY",
      "MAX_CONTENT_LENGTH", "MAX_CONCURRENT", "DEFAULT_MAX_KEYWORD",
      "DEFAULT_LIMIT", "MAX_QUERY_LENGTH",
    );
  });

  afterEach(() => {
    restoreEnv();
    // 清除模块缓存，确保每次重新加载
    vi.resetModules();
  });

  async function loadConfig() {
    const mod = await import("../src/config.js");
    return mod.loadConfig();
  }

  // ── 必需参数验证 ─────────────────────────────────

  it("缺少 MIMO_API_KEY 时抛出错误", async () => {
    delete process.env.MIMO_API_KEY;
    await expect(loadConfig()).rejects.toThrow("MIMO_API_KEY");
  });

  it("空字符串 MIMO_API_KEY 抛出错误", async () => {
    process.env.MIMO_API_KEY = "";
    await expect(loadConfig()).rejects.toThrow("MIMO_API_KEY");
  });

  // ── URL 验证 ─────────────────────────────────────

  it("无效 MIMO_BASE_URL 抛出错误", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_BASE_URL = "not-a-url";
    await expect(loadConfig()).rejects.toThrow("Invalid MIMO_BASE_URL");
  });

  it("MIMO_BASE_URL 尾部斜杠被去除", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_BASE_URL = "https://custom.api.com/v1///";
    const config = await loadConfig();
    expect(config.baseUrl).toBe("https://custom.api.com/v1");
  });

  // ── 默认值 ───────────────────────────────────────

  it("未设置可选环境变量时使用默认值", async () => {
    process.env.MIMO_API_KEY = "test-key";
    delete process.env.MIMO_BASE_URL;
    delete process.env.MIMO_MODEL;
    delete process.env.REQUEST_TIMEOUT;
    delete process.env.MAX_COMPLETION_TOKENS;
    delete process.env.TEMPERATURE;
    delete process.env.TOP_P;
    delete process.env.MIMO_STREAM;
    delete process.env.MIMO_THINKING;
    delete process.env.DEBUG;
    delete process.env.MAX_RETRIES;
    delete process.env.RETRY_DELAY;
    delete process.env.MAX_CONTENT_LENGTH;
    delete process.env.MAX_CONCURRENT;
    delete process.env.DEFAULT_MAX_KEYWORD;
    delete process.env.DEFAULT_LIMIT;
    delete process.env.MAX_QUERY_LENGTH;

    const config = await loadConfig();
    expect(config.apiKey).toBe("test-key");
    expect(config.baseUrl).toBe("https://api.xiaomimimo.com/v1");
    expect(config.model).toBe("mimo-v2.5-pro");
    expect(config.requestTimeout).toBe(60000);
    expect(config.maxCompletionTokens).toBe(5120);
    expect(config.temperature).toBe(0.4);
    expect(config.topP).toBe(0.95);
    expect(config.stream).toBe(false);
    expect(config.thinking).toBe(false);
    expect(config.logLevel).toBe(0); // ERROR
    expect(config.maxRetries).toBe(2);
    expect(config.retryDelay).toBe(1000);
    expect(config.maxContentLength).toBe(100000);
    expect(config.maxConcurrent).toBe(10);
    expect(config.defaultMaxKeyword).toBe(3);
    expect(config.defaultLimit).toBe(5);
    expect(config.maxQueryLength).toBe(10000);
  });

  // ── 自定义环境变量 ────────────────────────────────

  it("自定义环境变量正确覆盖默认值", async () => {
    process.env.MIMO_API_KEY = "custom-key";
    process.env.MIMO_BASE_URL = "https://custom.api.com/v2";
    process.env.MIMO_MODEL = "mimo-v3";
    process.env.REQUEST_TIMEOUT = "30000";
    process.env.MAX_COMPLETION_TOKENS = "1024";
    process.env.TEMPERATURE = "0.8";
    process.env.TOP_P = "0.5";
    process.env.MIMO_STREAM = "true";
    process.env.MIMO_THINKING = "true";
    process.env.DEBUG = "2";
    process.env.MAX_RETRIES = "5";
    process.env.RETRY_DELAY = "2000";
    process.env.MAX_CONTENT_LENGTH = "50000";
    process.env.MAX_CONCURRENT = "3";
    process.env.DEFAULT_MAX_KEYWORD = "10";
    process.env.DEFAULT_LIMIT = "20";
    process.env.MAX_QUERY_LENGTH = "5000";

    const config = await loadConfig();
    expect(config.apiKey).toBe("custom-key");
    expect(config.baseUrl).toBe("https://custom.api.com/v2");
    expect(config.model).toBe("mimo-v3");
    expect(config.requestTimeout).toBe(30000);
    expect(config.maxCompletionTokens).toBe(1024);
    expect(config.temperature).toBe(0.8);
    expect(config.topP).toBe(0.5);
    expect(config.stream).toBe(true);
    expect(config.thinking).toBe(true);
    expect(config.logLevel).toBe(3); // DEBUG
    expect(config.maxRetries).toBe(5);
    expect(config.retryDelay).toBe(2000);
    expect(config.maxContentLength).toBe(50000);
    expect(config.maxConcurrent).toBe(3);
    expect(config.defaultMaxKeyword).toBe(10);
    expect(config.defaultLimit).toBe(20);
    expect(config.maxQueryLength).toBe(5000);
  });

  // ── DEBUG 级别映射 ───────────────────────────────

  it("DEBUG=0 → ERROR 级别", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "0";
    const config = await loadConfig();
    expect(config.logLevel).toBe(0);
  });

  it("DEBUG=1 → INFO 级别", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "1";
    const config = await loadConfig();
    expect(config.logLevel).toBe(2);
  });

  it("DEBUG=2 → DEBUG 级别", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "2";
    const config = await loadConfig();
    expect(config.logLevel).toBe(3);
  });

  // ── DEBUG 命名空间模式 ─────────────────────────────

  it("DEBUG=mimo* → DEBUG 级别", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "mimo*";
    const config = await loadConfig();
    expect(config.logLevel).toBe(3);
  });

  it("DEBUG=mimo-web-search → DEBUG 级别", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "mimo-web-search";
    const config = await loadConfig();
    expect(config.logLevel).toBe(3);
  });

  it("DEBUG=*mimo* → DEBUG 级别", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "*mimo*";
    const config = await loadConfig();
    expect(config.logLevel).toBe(3);
  });

  it("DEBUG=other* → ERROR 级别（不匹配）", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.DEBUG = "other*";
    const config = await loadConfig();
    expect(config.logLevel).toBe(0);
  });

  // ── 无效数字回退 ─────────────────────────────────

  it("非数字的 REQUEST_TIMEOUT 回退默认值", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.REQUEST_TIMEOUT = "abc";
    const config = await loadConfig();
    expect(config.requestTimeout).toBe(60000);
  });

  it("非数字的 TEMPERATURE 回退默认值", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.TEMPERATURE = "xyz";
    const config = await loadConfig();
    expect(config.temperature).toBe(0.4);
  });

  // ── 布尔值解析 ───────────────────────────────────

  it("MIMO_STREAM=true 解析为 true", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_STREAM = "true";
    const config = await loadConfig();
    expect(config.stream).toBe(true);
  });

  it("MIMO_STREAM=1 解析为 true", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_STREAM = "1";
    const config = await loadConfig();
    expect(config.stream).toBe(true);
  });

  it("MIMO_STREAM=false 解析为 false", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_STREAM = "false";
    const config = await loadConfig();
    expect(config.stream).toBe(false);
  });

  it("MIMO_STREAM 未设置时默认 false", async () => {
    process.env.MIMO_API_KEY = "test-key";
    delete process.env.MIMO_STREAM;
    const config = await loadConfig();
    expect(config.stream).toBe(false);
  });

  it("MIMO_THINKING=true 解析为 true", async () => {
    process.env.MIMO_API_KEY = "test-key";
    process.env.MIMO_THINKING = "true";
    const config = await loadConfig();
    expect(config.thinking).toBe(true);
  });
});
