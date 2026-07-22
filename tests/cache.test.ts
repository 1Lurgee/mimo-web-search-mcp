import { describe, it, expect, vi, beforeEach } from "vitest";

// mock config 和 logger 必须在 import 之前
vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    apiKey: "test",
    baseUrl: "https://test.com",
    model: "mimo-v2.5-pro",
    requestTimeout: 60000,
    maxCompletionTokens: 5120,
    temperature: 0.4,
    topP: 0.95,
    thinking: false,
    logLevel: 0,
    maxRetries: 2,
    retryDelay: 1000,
    maxContentLength: 100000,
    maxConcurrent: 10,
    defaultMaxKeyword: 3,
    defaultLimit: 5,
    maxQueryLength: 10000,
    maxFetchSize: 10485760,
    fetchTimeout: 30000,
    enableBrowser: false,
    autoSummary: true,
  }),
}));

vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    isDebugEnabled: () => false,
    withReqId: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      isDebugEnabled: () => false,
    }),
  }),
}));

import { globalFetchCache } from "../src/cache.js";
import type { FetchPageResult } from "../src/fetch.js";

function makeResult(overrides?: Partial<FetchPageResult>): FetchPageResult {
  return {
    url: "https://example.com",
    status: 200,
    contentType: "text/html",
    size: 1000,
    content: "<html>hello</html>",
    ...overrides,
  };
}

describe("globalFetchCache", () => {
  beforeEach(() => {
    globalFetchCache.clear();
  });

  // ── 基本 get/set ────────────────────────────────────

  it("未写入时 get 返回 null", () => {
    expect(globalFetchCache.get("https://example.com")).toBeNull();
  });

  it("写入后 get 返回缓存的结果", () => {
    const result = makeResult();
    globalFetchCache.set("https://example.com", result);

    const cached = globalFetchCache.get("https://example.com");
    expect(cached).not.toBeNull();
    expect(cached?.url).toBe("https://example.com");
    expect(cached?.status).toBe(200);
    expect(cached?.content).toBe("<html>hello</html>");
  });

  it("不同 URL 的缓存互不影响", () => {
    globalFetchCache.set("https://a.com", makeResult({ url: "https://a.com" }));
    globalFetchCache.set("https://b.com", makeResult({ url: "https://b.com" }));

    expect(globalFetchCache.get("https://a.com")?.url).toBe("https://a.com");
    expect(globalFetchCache.get("https://b.com")?.url).toBe("https://b.com");
    expect(globalFetchCache.get("https://c.com")).toBeNull();
  });

  // ── clear ───────────────────────────────────────────

  it("clear 清除所有缓存", () => {
    globalFetchCache.set("https://a.com", makeResult({ url: "https://a.com" }));
    globalFetchCache.set("https://b.com", makeResult({ url: "https://b.com" }));

    globalFetchCache.clear();

    expect(globalFetchCache.get("https://a.com")).toBeNull();
    expect(globalFetchCache.get("https://b.com")).toBeNull();
  });

  // ── stats ───────────────────────────────────────────

  it("stats 返回正确的初始状态", () => {
    const stats = globalFetchCache.stats();
    expect(stats.itemCount).toBe(0);
    expect(stats.maxSize).toBe(50 * 1024 * 1024); // 50MB
  });

  it("stats 反映写入后的状态", () => {
    globalFetchCache.set("https://example.com", makeResult({ size: 5000 }));

    const stats = globalFetchCache.stats();
    expect(stats.itemCount).toBe(1);
    expect(stats.size).toBeGreaterThan(0);
  });

  // ── size=0 边界 ─────────────────────────────────────

  it("size=0 的条目至少占 1 字节权重（lru-cache 要求正整数）", () => {
    globalFetchCache.set("https://empty.com", makeResult({ size: 0 }));

    const cached = globalFetchCache.get("https://empty.com");
    expect(cached).not.toBeNull();
    expect(cached?.size).toBe(0);

    const stats = globalFetchCache.stats();
    expect(stats.itemCount).toBe(1);
    expect(stats.size).toBeGreaterThanOrEqual(1);
  });
});
