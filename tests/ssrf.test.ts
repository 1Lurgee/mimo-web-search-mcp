import { describe, it, expect } from "vitest";

// ── 导入被测模块 ──────────────────────────────────────
// 本地部署简化策略：允许 localhost / 私有 IP / 任意端口 / 凭证，
// 仅拦截非 http(s) 协议、无效格式、过长 URL。
const { validateUrl, isPermittedRedirect, redactUrl, isLocalOrPrivateHostname } = await import("../src/ssrf.js");

describe("validateUrl（本地部署简化策略）", () => {
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

  it("接受链路本地 / 元数据地址（本地部署不拦截）", () => {
    const result = validateUrl("http://169.254.169.254/latest/meta-data/");
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

  it("接受非 Web 端口（如 6379）", () => {
    const result = validateUrl("http://example.com:6379");
    expect(result.valid).toBe(true);
  });

  it("拒绝非 http/https 协议", () => {
    const result = validateUrl("ftp://example.com/file");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不支持的协议");
  });

  it("拒绝 file:// 协议", () => {
    const result = validateUrl("file:///etc/passwd");
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

describe("redactUrl", () => {
  it("无凭证 URL 原样返回", () => {
    expect(redactUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("脱敏 username:password", () => {
    const result = redactUrl("http://user:secret@localhost:8080/api");
    expect(result).toContain("***");
    expect(result).not.toContain("user");
    expect(result).not.toContain("secret");
    expect(result).toContain("localhost:8080/api");
  });

  it("仅 username 也脱敏", () => {
    const result = redactUrl("https://onlyuser@example.com/");
    expect(result).not.toContain("onlyuser");
    expect(result).toContain("example.com");
  });

  it("非法 URL 回退正则剥离 userinfo", () => {
    const result = redactUrl("not a url://user:pass@host");
    expect(result).not.toContain("user:pass");
  });
});

describe("isPermittedRedirect", () => {
  it("同主机同端口 https 重定向 -> 允许", () => {
    expect(isPermittedRedirect("https://example.com/a", "https://example.com/b")).toBe(true);
  });

  it("www 前缀增减 -> 允许", () => {
    expect(isPermittedRedirect("https://example.com/a", "https://www.example.com/b")).toBe(true);
    expect(isPermittedRedirect("https://www.example.com/a", "https://example.com/b")).toBe(true);
  });

  it("跨主机重定向 -> 拒绝", () => {
    expect(isPermittedRedirect("https://example.com/a", "https://evil.com/b")).toBe(false);
  });

  it("协议降级 HTTPS -> HTTP -> 拒绝", () => {
    expect(isPermittedRedirect("https://example.com/a", "http://example.com/b")).toBe(false);
  });

  it("端口变更 -> 拒绝", () => {
    expect(isPermittedRedirect("https://example.com/a", "https://example.com:8443/b")).toBe(false);
  });

  it("重定向目标携带凭证（同主机）-> 允许（相对 Location 会继承 base userinfo）", () => {
    expect(isPermittedRedirect("https://example.com/a", "https://user:pass@example.com/b")).toBe(true);
  });

  it("带凭证 base 解析出的相对重定向目标 -> 允许", () => {
    const base = "https://user:secret@example.com/start";
    const redirect = new URL("/next", base).toString();
    expect(redirect).toContain("user");
    expect(isPermittedRedirect(base, redirect)).toBe(true);
  });

  it("跨主机即使带凭证仍拒绝", () => {
    expect(isPermittedRedirect("https://user:pass@example.com/a", "https://user:pass@evil.com/b")).toBe(false);
  });

  it("无效 URL -> 拒绝", () => {
    expect(isPermittedRedirect("https://example.com/a", "not a url")).toBe(false);
  });
});

describe("isLocalOrPrivateHostname", () => {
  it("识别 localhost 与回环", () => {
    expect(isLocalOrPrivateHostname("localhost")).toBe(true);
    expect(isLocalOrPrivateHostname("127.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHostname("::1")).toBe(true);
  });

  it("识别私有网段", () => {
    expect(isLocalOrPrivateHostname("192.168.1.10")).toBe(true);
    expect(isLocalOrPrivateHostname("10.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHostname("172.16.0.1")).toBe(true);
    expect(isLocalOrPrivateHostname("169.254.169.254")).toBe(true);
  });

  it("公网主机为 false", () => {
    expect(isLocalOrPrivateHostname("example.com")).toBe(false);
    expect(isLocalOrPrivateHostname("8.8.8.8")).toBe(false);
  });
});
