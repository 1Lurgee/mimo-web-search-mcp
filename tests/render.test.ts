import { describe, it, expect, vi } from "vitest";
import type { AppConfig } from "../src/config.js";

// config/logger 已在调用时求值，测试经参数注入，无需 mock
const TEST_CONFIG: AppConfig = {
  apiKey: "test-api-key",
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.6-flash",
  requestTimeout: 60000,
  maxCompletionTokens: 1024,
  temperature: 0.3,
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
};

const { isSpaPage, renderWithBrowser } = await import("../src/render.js");

// ── renderWithBrowser 取消测试 ────────────────────────

const pw = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  goto: vi.fn(() => new Promise<Response>(() => {})),
  waitForTimeout: vi.fn(async () => {}),
  content: vi.fn(async () => "<html></html>"),
  isConnected: vi.fn(() => true),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => ({
      isConnected: pw.isConnected,
      newPage: vi.fn(async () => ({
        goto: pw.goto,
        waitForTimeout: pw.waitForTimeout,
        content: pw.content,
        close: pw.close,
      })),
    })),
  },
}));

describe("renderWithBrowser 取消", () => {
  it("signal 预先已中止 -> 不加载 playwright，直接返回取消", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await renderWithBrowser("https://example.com", 5000, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain("已取消");
    // 预先中止发生在动态 import 之前：不应启动浏览器
    expect(pw.goto).not.toHaveBeenCalled();
  });

  it("goto 进行中 abort -> 快速返回取消且 page.close 被调用", async () => {
    pw.goto.mockImplementationOnce(() => new Promise<Response>(() => {})); // 永不 resolve
    const controller = new AbortController();

    const pending = renderWithBrowser("https://example.com", 5000, controller.signal, TEST_CONFIG);
    // 等 goto 真正开始（launch + newPage 均为 async）
    await vi.waitFor(() => expect(pw.goto).toHaveBeenCalledTimes(1));
    controller.abort();

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toContain("已取消");
    expect(pw.close).toHaveBeenCalled();
  });
});

// ── isSpaPage 测试 ────────────────────────────────────

describe("isSpaPage", () => {
  it("短内容 + div#root -> 判定为 SPA", () => {
    const html = '<html><body><div id="root"></div></body></html>';
    expect(isSpaPage(html, 50)).toBe(true);
  });

  it("短内容 + div#app -> 判定为 SPA", () => {
    const html = '<html><body><div id="app"></div></body></html>';
    expect(isSpaPage(html, 100)).toBe(true);
  });

  it("短内容 + __NEXT_DATA__ -> 判定为 SPA", () => {
    const html = '<html><body><script>{"props":{},"__NEXT_DATA__":{"page":"/"}}</script></body></html>';
    expect(isSpaPage(html, 30)).toBe(true);
  });

  it("短内容 + window.__INITIAL_STATE__ -> 判定为 SPA", () => {
    const html = '<html><body><script>window.__INITIAL_STATE__ = {}</script></body></html>';
    expect(isSpaPage(html, 0)).toBe(true);
  });

  it("短内容 + __NUXT__ -> 判定为 SPA", () => {
    const html = '<html><body><script>window.__NUXT__ = {}</script></body></html>';
    expect(isSpaPage(html, 10)).toBe(true);
  });

  it("长内容（>= 200 字符）-> 不判定为 SPA（即使有 SPA 标记）", () => {
    const html = '<html><body><div id="root">' + "x".repeat(300) + '</div></body></html>';
    expect(isSpaPage(html, 250)).toBe(false);
  });

  it("短内容但无 SPA 标记 -> 不判定为 SPA", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    expect(isSpaPage(html, 50)).toBe(false);
  });

  it("空 HTML -> 不判定为 SPA", () => {
    expect(isSpaPage("", 0)).toBe(false);
  });
});
