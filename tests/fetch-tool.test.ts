import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── 设置环境变量（模块顶层代码需要）──────────────────
process.env.MIMO_API_KEY = "test-api-key";

// ── Mock 外部依赖 ────────────────────────────────────────

// Mock fetch.ts 导出的函数
vi.mock("../src/fetch.js", () => ({
  fetchPage: vi.fn(),
}));

// Mock ssrf.ts 导出的函数（validateUrl 已迁移到 ssrf.ts）
// 本地部署简化策略：生产仅校验协议/格式/长度，不拦截私有 IP
vi.mock("../src/ssrf.js", () => ({
  validateUrl: vi.fn(),
  isPermittedRedirect: vi.fn().mockReturnValue(true),
  redactUrl: (url: string) => url.replace(/\/\/([^/@]+)@/g, "//***@"),
}));

// Mock convert.ts 导出的函数
vi.mock("../src/convert.js", () => ({
  htmlToMarkdown: vi.fn(),
}));

// Mock render.ts 导出的函数（SPA 检测与浏览器渲染）
vi.mock("../src/render.js", () => ({
  isSpaPage: vi.fn().mockReturnValue(false),
  renderWithBrowser: vi.fn(),
  getSpaHint: vi.fn().mockReturnValue("\n\n[SPA hint]"),
}));

// ── 导入被测模块和 mock 引用 ─────────────────────────────

const { executeFetch } = await import("../src/fetch-tool.js");
const { fetchPage } = await import("../src/fetch.js");
const { validateUrl } = await import("../src/ssrf.js");
const { htmlToMarkdown } = await import("../src/convert.js");
const { isSpaPage, renderWithBrowser, getSpaHint } = await import("../src/render.js");

// 类型断言，方便后续 mock 调用
const mockValidateUrl = vi.mocked(validateUrl);
const mockFetchPage = vi.mocked(fetchPage);
const mockHtmlToMarkdown = vi.mocked(htmlToMarkdown);

// ── 辅助函数 ─────────────────────────────────────────────

/** 创建全局 fetch 的 mock（用于 MiMo API 调用） */
function mockGlobalFetchJson(status: number, json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
    headers: new Headers(),
    statusText: status === 200 ? "OK" : "Error",
  } as Response);
}

/** 创建全局 fetch 的 mock（模拟网络错误） */
function mockGlobalFetchError(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

/** 默认的 fetchPage 成功返回 */
function makeFetchPageSuccess(overrides: Partial<Awaited<ReturnType<typeof fetchPage>>> = {}) {
  return {
    url: "https://example.com",
    status: 200,
    contentType: "text/html; charset=utf-8",
    size: 1024,
    content: "<html><body><h1>Hello</h1></body></html>",
    ...overrides,
  };
}

// ── 测试 ─────────────────────────────────────────────────

describe("executeFetch", () => {
  beforeEach(() => {
    // 清除所有 mock 的调用记录和实现
    vi.clearAllMocks();
    // 默认：URL 验证通过
    mockValidateUrl.mockReturnValue({ valid: true });
    // 默认：抓取成功
    mockFetchPage.mockResolvedValue(makeFetchPageSuccess());
    // 默认：HTML 转 Markdown 返回简单内容
    mockHtmlToMarkdown.mockReturnValue("# Hello\n\nTest content.");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 成功场景（无 prompt）─────────────────────────────

  describe("成功抓取（无 prompt）", () => {
    it("有效 URL 成功抓取 -> 返回带元数据头的 Markdown", async () => {
      const result = await executeFetch({ url: "https://example.com", clean: true, maxLength: 50000 });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const text = result.content[0].text;
      // 包含元数据头
      expect(text).toContain("--- Web Fetch Result ---");
      // 包含 Markdown 内容
      expect(text).toContain("# Hello");
      expect(text).toContain("Test content.");
    });

    it("元数据头包含正确的 URL、Status、Content-Type、Size、时间戳", async () => {
      const result = await executeFetch({ url: "https://example.com/page", clean: true, maxLength: 50000 });

      const text = result.content[0].text;
      expect(text).toContain("URL: https://example.com");
      expect(text).toContain("Status: 200");
      expect(text).toContain("Content-Type: text/html; charset=utf-8");
      expect(text).toContain("Size: 1024 bytes");
      // 验证时间戳格式（ISO 8601）
      expect(text).toMatch(/Fetched at: \d{4}-\d{2}-\d{2}T/);
      // 无 prompt 时不应有 Mode 标记
      expect(text).not.toContain("Mode: AI processed");
    });

    it("无 prompt 时不调用全局 fetch（MiMo API）", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await executeFetch({ url: "https://example.com", clean: true, maxLength: 50000 });

      // 全局 fetch 不应被调用（无 prompt 不需要 AI 处理）
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── 成功场景（有 prompt）─────────────────────────────

  describe("成功抓取（有 prompt）", () => {
    it("有效 URL + prompt -> 调用 MiMo API 并返回 AI 处理结果", async () => {
      const mimoResponse = {
        choices: [{ message: { content: "这是 AI 分析的结果" } }],
        usage: { total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 },
      };
      vi.stubGlobal("fetch", mockGlobalFetchJson(200, mimoResponse));

      const result = await executeFetch({
        url: "https://example.com",
        prompt: "总结这个页面的内容",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // 包含元数据头
      expect(text).toContain("--- Web Fetch Result ---");
      expect(text).toContain("URL: https://example.com");
      // 包含 AI 处理结果
      expect(text).toContain("这是 AI 分析的结果");
      // 有 prompt 时应标记为 AI processed
      expect(text).toContain("Mode: AI processed");
    });

    it("MiMo API 请求体包含正确的参数", async () => {
      const mimoResponse = {
        choices: [{ message: { content: "AI result" } }],
        usage: {},
      };
      const fetchMock = mockGlobalFetchJson(200, mimoResponse);
      vi.stubGlobal("fetch", fetchMock);

      await executeFetch({
        url: "https://example.com",
        prompt: "提取关键信息",
        clean: true,
        maxLength: 50000,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      // 请求 MiMo API 的 chat/completions 端点
      expect(url).toContain("/chat/completions");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      // 包含 system 和 user 两条消息
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      // user 消息包含网页内容和用户 prompt
      expect(body.messages[1].content).toContain("## 网页内容");
      expect(body.messages[1].content).toContain("# Hello");
      expect(body.messages[1].content).toContain("## 用户要求");
      expect(body.messages[1].content).toContain("提取关键信息");
      // 包含模型配置
      expect(body.model).toBeDefined();
      expect(body.max_completion_tokens).toBeDefined();
      expect(body.temperature).toBeDefined();
      expect(body.top_p).toBeDefined();
      expect(body.stream).toBe(false);
    });
  });

  // ── URL 验证失败 ─────────────────────────────────────

  describe("URL 验证失败", () => {
    it("无效 URL 格式 -> 返回验证错误", async () => {
      mockValidateUrl.mockReturnValue({ valid: false, error: "无效的 URL 格式: not a url" });

      const result = await executeFetch({
        url: "not a url",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("URL 验证失败");
      expect(result.content[0].text).toContain("无效的 URL 格式");
      // 不应调用 fetchPage
      expect(mockFetchPage).not.toHaveBeenCalled();
    });

    it("不支持的协议 -> 返回错误", async () => {
      mockValidateUrl.mockReturnValue({ valid: false, error: "不支持的协议: ftp:" });

      const result = await executeFetch({
        url: "ftp://example.com/file",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("URL 验证失败");
      expect(result.content[0].text).toContain("不支持的协议");
    });
  });

  // ── 网页抓取失败 ─────────────────────────────────────

  describe("网页抓取失败", () => {
    it("HTTP 404 -> 返回错误信息（isError: true）", async () => {
      mockFetchPage.mockResolvedValue({
        url: "https://example.com/not-found",
        status: 404,
        contentType: null,
        size: 0,
        content: "",
        error: "HTTP 错误: 404 Not Found",
      });

      const result = await executeFetch({
        url: "https://example.com/not-found",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("网页抓取失败");
      expect(result.content[0].text).toContain("404");
    });

    it("DNS 解析失败 -> 返回错误信息", async () => {
      mockFetchPage.mockResolvedValue({
        url: "https://nonexistent.example.invalid",
        status: 0,
        contentType: null,
        size: 0,
        content: "",
        error: "DNS 解析失败: 无法解析主机名",
      });

      const result = await executeFetch({
        url: "https://nonexistent.example.invalid",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("网页抓取失败");
      expect(result.content[0].text).toContain("DNS 解析失败");
    });

    it("连接超时 -> 返回错误信息", async () => {
      mockFetchPage.mockResolvedValue({
        url: "https://slow.example.com",
        status: 0,
        contentType: null,
        size: 0,
        content: "",
        error: "请求超时（30000ms）",
      });

      const result = await executeFetch({
        url: "https://slow.example.com",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("网页抓取失败");
      expect(result.content[0].text).toContain("超时");
    });
  });

  // ── 非 HTML 内容 ─────────────────────────────────────

  describe("非 HTML 内容", () => {
    it("非 HTML Content-Type -> 返回原始文本（带元数据头）", async () => {
      mockFetchPage.mockResolvedValue({
        url: "https://example.com/data.json",
        status: 200,
        contentType: "application/json",
        size: 256,
        content: '{"key": "value"}',
      });

      const result = await executeFetch({
        url: "https://example.com/data.json",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // 包含元数据头
      expect(text).toContain("--- Web Fetch Result ---");
      expect(text).toContain("URL: https://example.com/data.json");
      expect(text).toContain("Status: 200");
      expect(text).toContain("Content-Type: application/json");
      expect(text).toContain("Size: 256 bytes");
      // 包含原始文本内容
      expect(text).toContain('{"key": "value"}');
      // 不应标记为 AI processed
      expect(text).not.toContain("Mode: AI processed");
      // 不应调用 htmlToMarkdown
      expect(mockHtmlToMarkdown).not.toHaveBeenCalled();
    });

    it("非 HTML 内容受 maxLength 限制", async () => {
      const longContent = "x".repeat(200000);
      mockFetchPage.mockResolvedValue({
        url: "https://example.com/large.txt",
        status: 200,
        contentType: "text/plain",
        size: 200000,
        content: longContent,
      });

      const result = await executeFetch({
        url: "https://example.com/large.txt",
        clean: true,
        maxLength: 1000,
      });

      const text = result.content[0].text;
      // 溢出处理会添加截断通知，内容长度可能略超 maxLength
      // 但应在合理范围内（maxLength + 截断通知长度）
      const contentPart = text.substring(text.indexOf("---\n\n") + 5);
      expect(contentPart.length).toBeLessThanOrEqual(1200); // 允许截断通知的额外长度
      expect(contentPart).toContain("[Content truncated due to size limit...]");
    });
  });

  // ── MiMo API 回退 ────────────────────────────────────

  describe("MiMo API 回退", () => {
    it("MiMo API 返回 HTTP 错误 -> 返回错误 + 原始 Markdown 作为 fallback", async () => {
      vi.stubGlobal("fetch", mockGlobalFetchJson(500, { error: "Internal Server Error" }));

      const result = await executeFetch({
        url: "https://example.com",
        prompt: "总结页面",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      // 包含 AI 分析失败的提示
      expect(text).toContain("AI 分析失败");
      expect(text).toContain("MiMo API 请求失败");
      // 包含原始 Markdown 作为 fallback
      expect(text).toContain("以下是原始网页内容");
      expect(text).toContain("# Hello");
    });

    it("MiMo API 网络异常 -> 返回错误 + 原始 Markdown 作为 fallback", async () => {
      vi.stubGlobal("fetch", mockGlobalFetchError(new Error("Connection refused")));

      const result = await executeFetch({
        url: "https://example.com",
        prompt: "总结页面",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("AI 分析失败");
      expect(text).toContain("MiMo API 请求异常");
      expect(text).toContain("以下是原始网页内容");
    });

    it("MiMo API 返回空响应 -> 返回错误 + 原始 Markdown 作为 fallback", async () => {
      vi.stubGlobal("fetch", mockGlobalFetchJson(200, { choices: [], usage: {} }));

      const result = await executeFetch({
        url: "https://example.com",
        prompt: "总结页面",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("AI 分析失败");
      expect(text).toContain("以下是原始网页内容");
    });

    it("MiMo API 超时 -> 返回超时错误 + 原始 Markdown 作为 fallback", async () => {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      (abortError as unknown as { cause: string }).cause = "request_timeout";
      vi.stubGlobal("fetch", mockGlobalFetchError(abortError));

      const result = await executeFetch({
        url: "https://example.com",
        prompt: "总结页面",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("AI 分析失败");
      expect(text).toContain("超时");
      expect(text).toContain("以下是原始网页内容");
    });

    it("fallback 内容包含元数据头", async () => {
      vi.stubGlobal("fetch", mockGlobalFetchJson(429, { error: "Rate limited" }));

      const result = await executeFetch({
        url: "https://example.com/article",
        prompt: "总结",
        clean: true,
        maxLength: 50000,
      });

      const text = result.content[0].text;
      expect(text).toContain("--- Web Fetch Result ---");
      expect(text).toContain("URL: https://example.com");
      expect(text).toContain("Status: 200");
    });
  });

  // ── 参数传递 ─────────────────────────────────────────

  describe("参数传递", () => {
    it("clean 参数正确传递给 htmlToMarkdown", async () => {
      await executeFetch({ url: "https://example.com", clean: false, maxLength: 50000 });

      expect(mockHtmlToMarkdown).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ clean: false }),
      );
    });

    it("maxLength 参数正确传递给 htmlToMarkdown", async () => {
      await executeFetch({ url: "https://example.com", clean: true, maxLength: 10000 });

      expect(mockHtmlToMarkdown).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxLength: 10000 }),
      );
    });

    it("signal 参数传递给 fetchPage", async () => {
      const controller = new AbortController();
      await executeFetch(
        { url: "https://example.com", clean: true, maxLength: 50000 },
        controller.signal,
      );

      expect(mockFetchPage).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // ── 边界情况 ─────────────────────────────────────────

  describe("边界情况", () => {
    it("contentType 为 null 时视为非 HTML", async () => {
      mockFetchPage.mockResolvedValue({
        url: "https://example.com/raw",
        status: 200,
        contentType: null,
        size: 100,
        content: "raw text content",
      });

      const result = await executeFetch({
        url: "https://example.com/raw",
        clean: true,
        maxLength: 50000,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("raw text content");
      expect(result.content[0].text).toContain("Content-Type: unknown");
      expect(mockHtmlToMarkdown).not.toHaveBeenCalled();
    });

    it("HTML 中包含 application/xhtml+xml 也视为 HTML", async () => {
      mockFetchPage.mockResolvedValue({
        url: "https://example.com/page",
        status: 200,
        contentType: "application/xhtml+xml; charset=utf-8",
        size: 512,
        content: "<html><body>XHTML content</body></html>",
      });
      mockHtmlToMarkdown.mockReturnValue("XHTML content");

      const result = await executeFetch({
        url: "https://example.com/page",
        clean: true,
        maxLength: 50000,
      });

      // 应走 HTML -> Markdown 路径
      expect(mockHtmlToMarkdown).toHaveBeenCalled();
      expect(result.content[0].text).toContain("XHTML content");
    });
  });

  // ── SPA 降级测试 ────────────────────────────────────

  describe("SPA 降级", () => {
    beforeEach(() => {
      vi.mocked(isSpaPage).mockReset();
      vi.mocked(renderWithBrowser).mockReset();
      vi.mocked(getSpaHint).mockReset();
      vi.mocked(getSpaHint).mockReturnValue("\n\n[SPA hint]");
    });

    it("非 SPA 页面 -> 正常返回 Markdown", async () => {
      mockValidateUrl.mockReturnValue({ valid: true });
      mockFetchPage.mockResolvedValue(
        makeFetchPageSuccess({ content: "<html><body>Normal page</body></html>" }),
      );
      mockHtmlToMarkdown.mockReturnValue("Normal page content that is long enough to not trigger SPA detection because it exceeds 200 characters threshold");
      vi.mocked(isSpaPage).mockReturnValue(false);

      const result = await executeFetch({ url: "https://example.com", clean: true, maxLength: 50000 });

      expect(result.isError).toBeFalsy();
      expect(renderWithBrowser).not.toHaveBeenCalled();
    });

    it("SPA 页面 + 浏览器关闭 -> 附加 SPA 提示", async () => {
      mockValidateUrl.mockReturnValue({ valid: true });
      mockFetchPage.mockResolvedValue(
        makeFetchPageSuccess({ content: '<html><body><div id="root"></div></body></html>' }),
      );
      mockHtmlToMarkdown.mockReturnValue(""); // 短内容触发 SPA 检测
      vi.mocked(isSpaPage).mockReturnValue(true);

      const result = await executeFetch({ url: "https://spa.example.com", clean: true, maxLength: 50000 });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[SPA hint]");
      expect(renderWithBrowser).not.toHaveBeenCalled(); // 浏览器未启用
    });

    it("非 clean 模式 -> 不触发 SPA 检测", async () => {
      mockValidateUrl.mockReturnValue({ valid: true });
      mockFetchPage.mockResolvedValue(
        makeFetchPageSuccess({ content: '<html><body><div id="root"></div></body></html>' }),
      );
      mockHtmlToMarkdown.mockReturnValue(""); // 短内容但 clean=false

      const result = await executeFetch({ url: "https://spa.example.com", clean: false, maxLength: 50000 });

      // clean=false 时不触发 SPA 检测
      expect(isSpaPage).not.toHaveBeenCalled();
      expect(renderWithBrowser).not.toHaveBeenCalled();
    });
  });
});
