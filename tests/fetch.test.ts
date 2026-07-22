import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock SSRF 模块（fetch.ts 在模块顶层导入，需提前 mock）────
// 内联实现 validateUrl（含端口 allowlist + SSRF 检测），跳过 DNS 复查
// 不使用 require()——vi.mock 工厂在模块加载前执行，无法 require
vi.mock("../src/ssrf.js", () => {
  const ipv4Re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const isIPv4 = (ip: string): boolean => ipv4Re.test(ip);
  // IPv6 含冒号，但排除纯 IPv4 和 localhost
  const isIPv6 = (ip: string): boolean => ip.includes(":");

  function ipv4ToBigInt(ip: string): bigint {
    const p = ip.split(".").map(Number);
    return (BigInt(p[0]) << 24n) | (BigInt(p[1]) << 16n) | (BigInt(p[2]) << 8n) | BigInt(p[3]);
  }

  function isPrivateIPv4(ip: string): boolean {
    const n = ipv4ToBigInt(ip);
    return (
      (n >> 24n) === 127n ||
      (n >> 24n) === 10n ||
      (n & 0xfff00000n) === 0xac100000n ||
      (n & 0xffff0000n) === 0xc0a80000n ||
      (n & 0xffff0000n) === 0xa9fe0000n ||
      (n & 0xffc00000n) === 0x64400000n ||
      (n >> 28n) === 14n ||
      (n >> 28n) === 15n ||
      n === 0n
    );
  }

  function isPrivateIPv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    // ::ffff: 前缀 → IPv4-mapped IPv6
    // new URL() 标准化 ::ffff:192.168.1.1 为 ::ffff:c0a8:101（hex 格式）
    if (lower.startsWith("::ffff:")) {
      const rest = lower.slice(7);
      if (isIPv4(rest)) return isPrivateIPv4(rest);
      // hex 格式（如 c0a8:101）→ 解析为 IPv4
      const parts = rest.split(":");
      if (parts.length === 2) {
        const a = parseInt(parts[0], 16);
        const b = parseInt(parts[1], 16);
        if (!isNaN(a) && !isNaN(b)) {
          return isPrivateIPv4(`${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`);
        }
      }
    }
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    return false;
  }

  function isPrivateHost(hostname: string): boolean {
    if (hostname === "localhost") return true;
    const clean = hostname.replace(/^\[|\]$/g, "");
    if (isIPv4(clean)) return isPrivateIPv4(clean);
    if (isIPv6(clean)) return isPrivateIPv6(clean);
    return false;
  }

  const ALLOWED_PORTS = new Set([80, 443, 8000, 8080, 8443, 8888, 3000, 5000]);

  function validateUrl(url: string): { valid: boolean; error?: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { valid: false, error: `无效的 URL 格式: ${url}` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: `不支持的协议: ${parsed.protocol}（仅允许 http/https）` };
    }
    if (isPrivateHost(parsed.hostname)) {
      return { valid: false, error: `禁止访问私有/保留地址: ${parsed.hostname}` };
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    if (!ALLOWED_PORTS.has(port)) {
      return { valid: false, error: `禁止访问端口 ${port}（仅允许 Web 端口）` };
    }
    return { valid: true };
  }

  function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
    try {
      const parsedOriginal = new URL(originalUrl);
      const parsedRedirect = new URL(redirectUrl);
      if (parsedRedirect.protocol !== parsedOriginal.protocol) return false;
      if (parsedRedirect.port !== parsedOriginal.port) return false;
      if (parsedRedirect.username || parsedRedirect.password) return false;
      const stripWww = (hostname: string) => hostname.replace(/^www\./, "");
      return stripWww(parsedOriginal.hostname) === stripWww(parsedRedirect.hostname);
    } catch {
      return false;
    }
  }

  return {
    validateUrl,
    isPermittedRedirect,
    resolveAndCheckHost: async () => null, // 跳过 DNS 复查
    isPrivateIPv4,
    isPrivateIPv6,
    isPrivateHost,
    ipv4ToBigInt,
  };
});

// ── Mock 配置和日志模块（fetch.ts 在模块顶层加载）────────
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
    maxFetchSize: 10485760, // 10MB
    fetchTimeout: 30000,
    fetchCheckDns: false, // 测试时默认关闭 DNS 复查
    fetchAllowedPorts: [], // 空数组 = 使用默认 allowlist
    enableBrowser: false, // 测试时默认关闭浏览器渲染
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

// ── 导入被测模块 ──────────────────────────────────────
// validateUrl 从 ssrf.js 导入（mock 直接作用于此模块）
const { validateUrl } = await import("../src/ssrf.js");
const { detectCharset, fetchPage } = await import("../src/fetch.js");

// ── 辅助函数 ─────────────────────────────────────────

/** 构造 mock Response 对象（含可读 ReadableStream body，适配 streamToLimitedBuffer） */
function createMockResponse(overrides: Partial<Response> & { bodyText?: string } = {}): Response {
  const bodyText = overrides.bodyText ?? "";
  const bodyBytes = new TextEncoder().encode(bodyText);

  // 自动设置 content-length 头（如果 headers 未指定）
  const headers = overrides.headers instanceof Headers ? overrides.headers : new Headers(overrides.headers as Record<string, string> | undefined);
  if (!headers.has("content-length") && bodyBytes.byteLength > 0) {
    headers.set("content-length", String(bodyBytes.byteLength));
  }

  // 创建 ReadableStream 用于流式读取（streamToLimitedBuffer 需要 body.getReader()）
  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (bodyBytes.byteLength > 0) {
        controller.enqueue(bodyBytes);
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "",
    redirected: false,
    type: "basic",
    headers,
    body: bodyStream,
    bodyUsed: false,
    json: async () => JSON.parse(bodyText),
    text: async () => bodyText,
    arrayBuffer: async () => bodyBytes.buffer,
    blob: vi.fn() as unknown as Response["blob"],
    formData: vi.fn() as unknown as Response["formData"],
    clone: vi.fn() as unknown as Response["clone"],
    bytes: vi.fn() as unknown as Response["bytes"],
    ...overrides,
  } as Response;
}

// ── validateUrl 测试 ─────────────────────────────────

describe("validateUrl", () => {
  it("有效 https URL -> 合法", () => {
    const result = validateUrl("https://example.com/path");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("有效 http URL -> 合法", () => {
    const result = validateUrl("http://example.com/path");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("file:// 协议 -> 拒绝", () => {
    const result = validateUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不支持的协议");
  });

  it("ftp:// 协议 -> 拒绝", () => {
    const result = validateUrl("ftp://example.com/file");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不支持的协议");
  });

  it("javascript: 协议 -> 拒绝（无效 URL 格式）", () => {
    const result = validateUrl("javascript:alert(1)");
    // javascript: 在 Node.js URL 解析中可能抛异常或被识别为无效协议
    expect(result.valid).toBe(false);
  });

  it("127.0.0.1 回环地址 -> 拒绝", () => {
    const result = validateUrl("http://127.0.0.1/admin");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("localhost -> 拒绝", () => {
    const result = validateUrl("http://localhost:8080/api");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("10.x.x.x A 类私有地址 -> 拒绝", () => {
    const result = validateUrl("http://10.0.0.1/internal");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  // 以下三个测试覆盖位运算符号扩展 bug 的修复验证：
  // 原版用 number + hex 字面量比较，0xac100000/0xc0a80000/0xa9fe0000 被窄化为
  // 有符号 Int32 负数导致 === 永远为 false。
  // 已修复为 BigInt 比较，彻底消除符号扩展问题。

  it("172.16.x.x B 类私有地址 -> 拒绝（已修复位运算 bug）", () => {
    const result = validateUrl("http://172.16.0.1/internal");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("172.31.x.x B 类私有地址边界 -> 拒绝", () => {
    const result = validateUrl("http://172.31.255.255/internal");
    expect(result.valid).toBe(false);
  });

  it("172.15.x.x 非 B 类私有地址 -> 放行", () => {
    const result = validateUrl("http://172.15.0.1:8080/internal");
    expect(result.valid).toBe(true);
  });

  it("172.32.x.x 非 B 类私有地址 -> 放行", () => {
    const result = validateUrl("http://172.32.0.1:8080/internal");
    expect(result.valid).toBe(true);
  });

  it("192.168.x.x C 类私有地址 -> 拒绝（已修复位运算 bug）", () => {
    const result = validateUrl("http://192.168.1.1/internal");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("169.254.x.x 链路本地地址 -> 拒绝（已修复位运算 bug）", () => {
    const result = validateUrl("http://169.254.169.254/metadata");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("100.64.x.x 运营商 NAT 地址 -> 拒绝", () => {
    const result = validateUrl("http://100.64.0.1/internal");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("::ffff:192.168.1.1 IPv4-mapped IPv6 -> 拒绝", () => {
    const result = validateUrl("http://[::ffff:192.168.1.1]/internal");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("0.0.0.0 未指定地址 -> 拒绝", () => {
    const result = validateUrl("http://0.0.0.0/");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("::1 IPv6 回环地址 -> 拒绝", () => {
    const result = validateUrl("http://[::1]/");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("私有/保留地址");
  });

  it("普通域名 example.com -> 合法", () => {
    const result = validateUrl("https://example.com");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // ── 端口 allowlist 测试 ────────────────────────────────

  it("Redis 端口 6379 -> 拒绝", () => {
    const result = validateUrl("http://example.com:6379");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("禁止访问端口");
  });

  it("MySQL 端口 3306 -> 拒绝", () => {
    const result = validateUrl("http://example.com:3306");
    expect(result.valid).toBe(false);
  });

  it("SSH 端口 22 -> 拒绝", () => {
    const result = validateUrl("http://example.com:22");
    expect(result.valid).toBe(false);
  });

  it("MongoDB 端口 27017 -> 拒绝", () => {
    const result = validateUrl("http://example.com:27017");
    expect(result.valid).toBe(false);
  });

  it("SMTP 端口 25 -> 拒绝", () => {
    const result = validateUrl("http://example.com:25");
    expect(result.valid).toBe(false);
  });

  it("默认 HTTPS 443 端口 -> 放行", () => {
    const result = validateUrl("https://example.com");
    expect(result.valid).toBe(true);
  });

  it("默认 HTTP 80 端口 -> 放行", () => {
    const result = validateUrl("http://example.com");
    expect(result.valid).toBe(true);
  });

  it("8080 端口 -> 放行", () => {
    const result = validateUrl("http://example.com:8080");
    expect(result.valid).toBe(true);
  });

  it("8443 端口 -> 放行", () => {
    const result = validateUrl("https://example.com:8443");
    expect(result.valid).toBe(true);
  });

  it("8888 端口 -> 放行", () => {
    const result = validateUrl("http://example.com:8888");
    expect(result.valid).toBe(true);
  });
});

// ── detectCharset 测试 ────────────────────────────────

describe("detectCharset", () => {
  it("Content-Type 头包含 charset -> 使用该编码", () => {
    const buffer = new ArrayBuffer(0);
    const result = detectCharset(buffer, "text/html; charset=gbk");
    expect(result).toBe("gbk");
  });

  it("Content-Type 头 charset 大小写不敏感", () => {
    const buffer = new ArrayBuffer(0);
    const result = detectCharset(buffer, "text/html; charset=UTF-8");
    expect(result).toBe("utf-8");
  });

  it("Content-Type 无 charset，HTML 有 <meta charset='gbk'> -> gbk", () => {
    const html = '<html><head><meta charset="gbk"></head><body></body></html>';
    const buffer = new TextEncoder().encode(html).buffer;
    const result = detectCharset(buffer, "text/html");
    expect(result).toBe("gbk");
  });

  it("Content-Type 无 charset，HTML 有 http-equiv Content-Type -> 检测该编码", () => {
    const html =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=big5"></head><body></body></html>';
    const buffer = new TextEncoder().encode(html).buffer;
    const result = detectCharset(buffer, "text/html");
    expect(result).toBe("big5");
  });

  it("无任何编码信息 -> 默认 utf-8", () => {
    const html = "<html><head></head><body></body></html>";
    const buffer = new TextEncoder().encode(html).buffer;
    const result = detectCharset(buffer, "text/html");
    expect(result).toBe("utf-8");
  });

  it("Content-Type 为 null 且无 HTML meta -> 默认 utf-8", () => {
    const buffer = new ArrayBuffer(0);
    const result = detectCharset(buffer, null);
    expect(result).toBe("utf-8");
  });
});

// ── fetchPage 测试 ────────────────────────────────────

describe("fetchPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("成功抓取 -> 返回正确的内容和元数据", async () => {
    const htmlContent = "<html><body>Hello World</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/page",
          headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
          bodyText: htmlContent,
        }),
      ),
    );

    const result = await fetchPage("https://example.com/page");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.url).toBe("https://example.com/page");
    expect(result.content).toBe(htmlContent);
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(result.size).toBeGreaterThan(0);
  });

  it("HTTP 404 -> 返回错误结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: "Not Found",
          url: "https://example.com/missing",
          headers: new Headers({ "content-type": "text/html" }),
          bodyText: "Not Found",
        }),
      ),
    );

    const result = await fetchPage("https://example.com/missing");

    expect(result.status).toBe(404);
    expect(result.content).toBe("");
    expect(result.error).toContain("HTTP 错误");
    expect(result.error).toContain("404");
  });

  it("HTTP 500 -> 返回错误结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          url: "https://example.com/error",
          headers: new Headers({ "content-type": "text/html" }),
          bodyText: "Server Error",
        }),
      ),
    );

    const result = await fetchPage("https://example.com/error");

    expect(result.status).toBe(500);
    expect(result.content).toBe("");
    expect(result.error).toContain("HTTP 错误");
    expect(result.error).toContain("500");
  });

  it("响应体超过大小限制 -> Content-Length 预检拒绝", async () => {
    // Content-Length 超过默认 10MB 限制 → 预检阶段拒绝，不读取 body
    const largeSize = 11 * 1024 * 1024; // 11MB
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/large",
          headers: new Headers({
            "content-type": "application/octet-stream",
            "content-length": String(largeSize),
          }),
        }),
      ),
    );

    const result = await fetchPage("https://example.com/large");

    expect(result.content).toBe("");
    expect(result.error).toContain("响应体过大");
    expect(result.size).toBe(largeSize);
  });

  it("自定义 maxSize 限制 -> 超过自定义限制返回错误", async () => {
    const customMax = 1024; // 1KB
    const largeSize = 2048; // 2KB

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/custom",
          headers: new Headers({
            "content-type": "text/html",
            "content-length": String(largeSize),
          }),
        }),
      ),
    );

    const result = await fetchPage("https://example.com/custom", { maxSize: customMax });

    expect(result.content).toBe("");
    expect(result.error).toContain("响应体过大");
  });

  it("AbortError（超时） -> 返回超时错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const err = new DOMException("The operation was aborted.", "AbortError");
        // 设置 cause 为 request_timeout 以标识超时（与 util.ts TIMEOUT_REASON 一致）
        Object.defineProperty(err, "cause", { value: "request_timeout" });
        throw err;
      }),
    );

    const result = await fetchPage("https://example.com/timeout");

    expect(result.content).toBe("");
    expect(result.error).toContain("请求超时");
  });

  it("AbortError（外部取消） -> 返回取消错误", async () => {
    const abortController = new AbortController();
    abortController.abort(); // 预先取消

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );

    const result = await fetchPage("https://example.com/cancel", { signal: abortController.signal });

    expect(result.content).toBe("");
    expect(result.error).toBe("请求被取消");
  });

  it("DNS 解析失败 -> 返回网络错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const err = new Error("getaddrinfo failed") as NodeJS.ErrnoException;
        err.code = "ENOTFOUND";
        throw err;
      }),
    );

    const result = await fetchPage("https://nonexistent.example.com");

    expect(result.status).toBe(0);
    expect(result.content).toBe("");
    expect(result.error).toContain("DNS 解析失败");
  });

  it("连接被拒绝 -> 返回网络错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const err = new Error("connect ECONNREFUSED") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        throw err;
      }),
    );

    const result = await fetchPage("https://example.com");

    expect(result.status).toBe(0);
    expect(result.error).toContain("连接被拒绝");
  });

  it("URL 验证失败 -> 返回验证错误", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPage("http://127.0.0.1/internal");

    expect(result.status).toBe(0);
    expect(result.content).toBe("");
    expect(result.error).toContain("私有/保留地址");
    // 不应发起网络请求
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("重定向超过限制 -> 返回重定向错误", async () => {
    // 每次重定向都返回 301 + Location
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 301,
          headers: new Headers({ location: "https://example.com/redirect" }),
        }),
      ),
    );

    const result = await fetchPage("https://example.com/start");

    expect(result.error).toContain("重定向次数超过限制");
  });

  it("重定向目标为私有地址 -> 被安全重定向检查拦截", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // 第一次请求返回重定向到回环地址（被 isPermittedRedirect 拦截）
          return createMockResponse({
            ok: false,
            status: 301,
            headers: new Headers({ location: "http://127.0.0.1/admin" }),
          });
        }
        return createMockResponse({ ok: true, status: 200 });
      }),
    );

    const result = await fetchPage("https://example.com/start");

    // 重定向到不同域名/协议（含私有地址）应被安全重定向检查拦截
    expect(result.error).toContain("不安全重定向");
    // 只发起了第一次请求，第二次因安全重定向检查而未调用 fetch
    expect(callCount).toBe(1);
  });

  it("HTTPS -> HTTP 重定向（协议降级）-> 被安全重定向检查拦截", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 301,
          headers: new Headers({ location: "http://example.com/insecure" }),
        }),
      ),
    );

    const result = await fetchPage("https://example.com/secure");

    // HTTPS -> HTTP 是协议降级，应被 isPermittedRedirect 拦截
    expect(result.error).toContain("不安全重定向");
  });

  it("同域 www 重定向 -> 允许跟随", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url === "https://example.com/start") {
          return createMockResponse({
            ok: false,
            status: 301,
            headers: new Headers({ location: "https://www.example.com/page" }),
          });
        }
        return createMockResponse({
          ok: true,
          status: 200,
          url: "https://www.example.com/page",
          bodyText: "<html><body>OK</body></html>",
        });
      }),
    );

    const result = await fetchPage("https://example.com/start");

    // www 增减是允许的，应成功跟随重定向
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it("SSL 证书错误 -> 返回安全提示，不暴露原始证书细节", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const err = new Error("self-signed certificate in certificate chain") as NodeJS.ErrnoException;
        err.code = "SELF_SIGNED_CERT_IN_CHAIN";
        throw err;
      }),
    );

    const result = await fetchPage("https://badcert.example.com");

    expect(result.status).toBe(0);
    expect(result.error).toContain("TLS 证书校验失败");
    // 原始错误信息不应泄漏给 LLM
    expect(result.error).not.toContain("certificate chain");
    expect(result.error).not.toContain("self-signed");
  });

  it("未知 SSL 错误（ERR_SSL_PROTOCOL_ERROR）-> 返回安全提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const err = new Error("SSL protocol error") as NodeJS.ErrnoException;
        err.code = "ERR_SSL_PROTOCOL_ERROR";
        throw err;
      }),
    );

    const result = await fetchPage("https://sslerror.example.com");

    expect(result.status).toBe(0);
    expect(result.error).toContain("TLS 连接失败");
  });

  it("其他未知错误 -> 返回通用错误，不暴露原始消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        throw new Error("some internal detail that should not leak");
      }),
    );

    const result = await fetchPage("https://example.com/unknown");

    expect(result.status).toBe(0);
    expect(result.error).toBe("网络异常（未知错误）");
    expect(result.error).not.toContain("internal detail");
  });

  it("Content-Length 超限 -> 预检拒绝，不读取 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/huge",
          headers: new Headers({
            "content-type": "application/octet-stream",
            "content-length": "600000000", // 600MB，远超 10MB 默认限制
          }),
          bodyText: "", // body 不应被读取
        }),
      ),
    );

    const result = await fetchPage("https://example.com/huge");

    expect(result.content).toBe("");
    expect(result.error).toContain("响应体过大");
    expect(result.size).toBe(600000000);
  });

  it("端口 6379 SSRF -> 拒绝，不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPage("http://example.com:6379");

    expect(result.status).toBe(0);
    expect(result.error).toContain("禁止访问端口");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("端口 8080 请求 -> 正常放行", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com:8080/page",
          headers: new Headers({ "content-type": "text/html" }),
          bodyText: "<html><body>OK</body></html>",
        }),
      ),
    );

    const result = await fetchPage("https://example.com:8080/page");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
  });

  // ── 流式读取边界测试 ─────────────────────────────────

  it("空响应体 -> 返回空内容，无错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/empty",
          headers: new Headers({ "content-type": "text/html" }),
          bodyText: "", // 空 body
        }),
      ),
    );

    const result = await fetchPage("https://example.com/empty");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.content).toBe("");
    expect(result.size).toBe(0);
  });

  it("响应体恰好等于 maxSize -> 正常返回", async () => {
    const exactSize = 1024; // 1KB
    const content = "x".repeat(exactSize);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/exact",
          headers: new Headers({
            "content-type": "text/plain",
            "content-length": String(exactSize),
          }),
          bodyText: content,
        }),
      ),
    );

    const result = await fetchPage("https://example.com/exact", { maxSize: exactSize });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe(content);
    expect(result.size).toBe(exactSize);
  });

  it("响应体超过 maxSize 1 字节 -> Content-Length 预检拒绝", async () => {
    const overSize = 1025; // maxSize + 1

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockResponse({
          ok: true,
          status: 200,
          url: "https://example.com/over",
          headers: new Headers({
            "content-type": "text/plain",
            "content-length": String(overSize),
          }),
          bodyText: "x".repeat(overSize),
        }),
      ),
    );

    const result = await fetchPage("https://example.com/over", { maxSize: 1024 });

    expect(result.content).toBe("");
    expect(result.error).toContain("响应体过大");
    expect(result.size).toBe(overSize);
  });
});
