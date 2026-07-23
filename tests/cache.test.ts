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
  // ── 基本 get/set ────────────────────────────────────

  it("未写入时 get 返回 null", () => {
    expect(globalFetchCache.get("https://get-null.test")).toBeNull();
  });

  it("写入后 get 返回缓存的结果", () => {
    const result = makeResult({ url: "https://get-set.test" });
    globalFetchCache.set("https://get-set.test", result);

    const cached = globalFetchCache.get("https://get-set.test");
    expect(cached).not.toBeNull();
    expect(cached?.url).toBe("https://get-set.test");
    expect(cached?.status).toBe(200);
    expect(cached?.content).toBe("<html>hello</html>");
  });

  it("不同 URL 的缓存互不影响", () => {
    globalFetchCache.set("https://url-a.test", makeResult({ url: "https://url-a.test" }));
    globalFetchCache.set("https://url-b.test", makeResult({ url: "https://url-b.test" }));

    expect(globalFetchCache.get("https://url-a.test")?.url).toBe("https://url-a.test");
    expect(globalFetchCache.get("https://url-b.test")?.url).toBe("https://url-b.test");
    expect(globalFetchCache.get("https://url-c.test")).toBeNull();
  });

  // ── size=0 边界 ─────────────────────────────────────

  it("size=0 的条目可以正常缓存和读取", () => {
    globalFetchCache.set("https://empty-size.test", makeResult({ url: "https://empty-size.test", size: 0 }));

    const cached = globalFetchCache.get("https://empty-size.test");
    expect(cached).not.toBeNull();
    expect(cached?.size).toBe(0);
  });
});
