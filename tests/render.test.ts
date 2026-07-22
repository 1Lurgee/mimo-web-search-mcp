import { describe, it, expect, vi } from "vitest";

// ── Mock 配置和日志模块 ──────────────────────────────
vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    apiKey: "test-api-key",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.5-pro",
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
    fetchCheckDns: false,
    fetchAllowedPorts: [],
    enableBrowser: false,
  }),
}));

vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { isSpaPage } = await import("../src/render.js");

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
