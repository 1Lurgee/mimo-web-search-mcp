import { describe, it, expect } from "vitest";

// ── 导入被测模块 ──────────────────────────────────────
const { validateUrl } = await import("../src/ssrf.js");

describe("validateUrl", () => {
  it("接受有效的 http URL", () => {
    const result = validateUrl("http://example.com/path");
    expect(result.valid).toBe(true);
  });

  it("接受有效的 https URL", () => {
    const result = validateUrl("https://example.com/path?q=1#frag");
    expect(result.valid).toBe(true);
  });

  it("接受 localhost URL", () => {
    const result = validateUrl("http://localhost:3000/api");
    expect(result.valid).toBe(true);
  });

  it("接受私有 IP URL", () => {
    const result = validateUrl("http://192.168.1.1:8080/api");
    expect(result.valid).toBe(true);
  });

  it("接受包含凭证的 URL", () => {
    const result = validateUrl("http://user:pass@localhost:8080/api");
    expect(result.valid).toBe(true);
  });

  it("接受任意端口", () => {
    const result = validateUrl("http://localhost:9090/api");
    expect(result.valid).toBe(true);
  });

  it("拒绝非 http/https 协议", () => {
    const result = validateUrl("ftp://example.com/file");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不支持的协议");
  });

  it("拒绝无效 URL 格式", () => {
    const result = validateUrl("not a url");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("无效的 URL 格式");
  });

  it("拒绝过长的 URL", () => {
    const longUrl = "https://example.com/" + "a".repeat(10000);
    const result = validateUrl(longUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("URL 过长");
  });
});
