import { describe, it, expect, vi, beforeEach } from "vitest";

// cache.ts 已纯化（零 config/logger 依赖），无需 mock
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
