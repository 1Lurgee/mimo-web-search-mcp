import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock config 必须在 import 之前
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

import { mergeAbortSignals, calculateRetryDelay, fetchWithTimeout, TIMEOUT_REASON } from "../src/util.js";

describe("mergeAbortSignals", () => {
  it("单个未中止信号返回自身", () => {
    const controller = new AbortController();
    const result = mergeAbortSignals(controller.signal);
    expect(result.aborted).toBe(false);
  });

  it("多个未中止信号返回合并信号", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const result = mergeAbortSignals(c1.signal, c2.signal);
    expect(result.aborted).toBe(false);
  });

  it("任一信号中止时合并信号也中止", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const result = mergeAbortSignals(c1.signal, c2.signal);

    c1.abort("reason1");
    expect(result.aborted).toBe(true);
  });

  it("已中止信号立即返回已中止状态", () => {
    const c1 = new AbortController();
    c1.abort("already_done");
    const c2 = new AbortController();

    const result = mergeAbortSignals(c1.signal, c2.signal);
    expect(result.aborted).toBe(true);
  });

  it("所有信号都已中止时返回已中止状态", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    c1.abort("a");
    c2.abort("b");

    const result = mergeAbortSignals(c1.signal, c2.signal);
    expect(result.aborted).toBe(true);
  });
});

describe("calculateRetryDelay", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次重试（attempt=0）返回 baseDelay + jitter", () => {
    // baseDelay = 1000 * 2^0 = 1000, jitter = 0.5 * 1000 * 0.5 = 250
    const delay = calculateRetryDelay(0);
    expect(delay).toBe(1250);
  });

  it("第二次重试（attempt=1）返回 2x baseDelay + jitter", () => {
    // baseDelay = 1000 * 2^1 = 2000, jitter = 0.5 * 2000 * 0.5 = 500
    const delay = calculateRetryDelay(1);
    expect(delay).toBe(2500);
  });

  it("指数增长：attempt=2 是 attempt=0 的 4 倍基础延迟", () => {
    const delay0 = calculateRetryDelay(0);
    const delay2 = calculateRetryDelay(2);
    // delay2 / delay0 应该接近 4（因为 jitter 比例相同）
    expect(delay2 / delay0).toBeCloseTo(4, 0);
  });
});

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("正常响应成功返回", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout("https://example.com", {}, 5000);
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("外部信号中止时抛出 AbortError", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
    );

    const promise = fetchWithTimeout("https://example.com", {}, 60000, controller.signal);

    // 立即中止
    controller.abort();

    await expect(promise).rejects.toThrow();
  });
});

describe("TIMEOUT_REASON", () => {
  it("是字符串常量", () => {
    expect(typeof TIMEOUT_REASON).toBe("string");
    expect(TIMEOUT_REASON).toBe("request_timeout");
  });
});
