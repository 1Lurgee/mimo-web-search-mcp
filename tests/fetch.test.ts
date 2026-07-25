import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 使用真实 ssrf.ts（本地部署简化策略）：
// - 仅校验协议 / URL 格式 / 长度
// - 允许 localhost、私有 IP、任意端口、凭证
// 详细契约见 tests/ssrf.test.ts；本文件聚焦 fetchPage 行为

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
    enableBrowser: false, // 测试时默认关闭浏览器渲染
    autoSummary: true,
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
const { detectCharset, fetchPage } = await import("../src/fetch.js");
const { globalFetchCache } = await import("../src/cache.js");

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
    globalFetchCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalFetchCache.clear();
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

  it("URL 验证失败（非 http/https）-> 返回验证错误", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // 本地部署允许私有 IP；仅拒绝非 http/https 协议
    const result = await fetchPage("file:///etc/passwd");

    expect(result.status).toBe(0);
    expect(result.content).toBe("");
    expect(result.error).toContain("不支持的协议");
    // 不应发起网络请求
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("本地部署允许私有地址 -> 保持 http 不升级并会发起请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createMockResponse({
        ok: true,
        status: 200,
        url: "http://127.0.0.1/internal",
        headers: new Headers({ "content-type": "text/html" }),
        bodyText: "<html><body>local</body></html>",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // 回环/私有地址不应 HTTP→HTTPS 升级
    const result = await fetchPage("http://127.0.0.1/internal");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.startsWith("http://127.0.0.1")).toBe(true);
  });

  it("公网 http URL -> 自动升级为 https 再请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createMockResponse({
        ok: true,
        status: 200,
        url: "https://example.com/",
        headers: new Headers({ "content-type": "text/html" }),
        bodyText: "<html><body>ok</body></html>",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPage("http://example.com/");
    expect(result.error).toBeUndefined();
    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.startsWith("https://example.com")).toBe(true);
  });

  it("body 读取中途 abort -> 返回取消错误且不缓存半截内容", async () => {
    const controller = new AbortController();
    const url = "https://example.com/partial-abort-mid-stream";

    const makeStream = () => {
      let pullCount = 0;
      return new ReadableStream<Uint8Array>({
        pull(ctrl) {
          pullCount++;
          if (pullCount === 1) {
            ctrl.enqueue(new TextEncoder().encode("<html><body>partial-secret"));
            // 同步 abort：read() 返回后循环应看到 signal.aborted 并抛错
            controller.abort();
            return;
          }
          ctrl.enqueue(new TextEncoder().encode("-more"));
          ctrl.close();
        },
      });
    };

    const fetchMock = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        headers: new Headers({ "content-type": "text/html" }),
        body: makeStream(),
        bodyUsed: false,
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchPage(url, { signal: controller.signal });
    expect(first.error).toBe("请求被取消");
    expect(first.content).toBe("");
    // 错误结果不得写入缓存
    expect(globalFetchCache.get(url)).toBeNull();

    // 第二次无 abort：必须重新发请求（证明未缓存半截成功）
    const second = await fetchPage(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.error).toBeUndefined();
    expect(second.content).toContain("partial-secret");
  });

  it("带凭证同站相对重定向 -> 允许跟随", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        const u = String(url);
        if (u.includes("/start")) {
          return createMockResponse({
            ok: false,
            status: 302,
            headers: new Headers({ location: "/next" }),
          });
        }
        return createMockResponse({
          ok: true,
          status: 200,
          url: u,
          headers: new Headers({ "content-type": "text/html" }),
          bodyText: "<html><body>authed</body></html>",
        });
      }),
    );

    const result = await fetchPage("https://user:secret@example.com/start");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(callCount).toBe(2);
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

  it("跨主机重定向 -> 被 isPermittedRedirect 拦截", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // 跨主机重定向（即使目标是公网）也不自动跟随
          return createMockResponse({
            ok: false,
            status: 301,
            headers: new Headers({ location: "https://evil.example/phish" }),
          });
        }
        return createMockResponse({ ok: true, status: 200 });
      }),
    );

    const result = await fetchPage("https://example.com/start");

    // 主机名不一致 -> 不安全重定向
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

  it("本地部署允许任意端口 -> 公网 http 升级为 https 后请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createMockResponse({
        ok: true,
        status: 200,
        // 公网 HTTP 自动升级后 URL 为 https://example.com:6379/
        url: "https://example.com:6379/",
        headers: new Headers({ "content-type": "text/plain" }),
        bodyText: "ok",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPage("http://example.com:6379");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/example\.com:6379\/?$/);
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
