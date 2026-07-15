import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// ── Mock MCP SDK ──────────────────────────────────────
// 捕获 server.tool() 注册的工具处理器

type ToolHandler = (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>;

let capturedHandler: ToolHandler | null = null;
let capturedToolName: string | null = null;

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      capturedToolName = name;
      capturedHandler = handler;
    }
    async connect() {}
  },
}));

/**
 * 包装 capturedHandler，自动补全 MCP SDK 注入的 extra.signal
 * 测试代码不需要关心第二个参数，除非专门测试取消行为
 */
function callHandler(args: Record<string, unknown>, signal?: AbortSignal) {
  return capturedHandler!(args, { signal: signal ?? new AbortController().signal });
}

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    async close() {}
  },
}));

// ── 设置环境变量（模块顶层代码需要）──────────────────
process.env.MIMO_API_KEY = "test-api-key";

// ── 导入被测模块 ──────────────────────────────────────
// 动态导入，确保 mock 生效后再加载
const { default: _mod } = await import("../src/index.js");
// index.ts 是副作用模块，导入即执行，handler 已被捕获

// ── 辅助函数 ─────────────────────────────────────────

function mockFetch(response: Partial<Response> & { body?: string }) {
  const defaultResponse: Response = {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: "test result" } }],
      usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 },
    }),
    text: async () => response.body ?? "",
    headers: new Headers(),
    statusText: "OK",
    redirected: false,
    type: "basic",
    url: "",
    clone: vi.fn() as unknown as Response["clone"],
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn() as unknown as Response["arrayBuffer"],
    blob: vi.fn() as unknown as Response["blob"],
    formData: vi.fn() as unknown as Response["formData"],
    bytes: vi.fn() as unknown as Response["bytes"],
    ...response,
  } as Response;

  return vi.fn().mockResolvedValue(defaultResponse);
}

function mockFetchJson(status: number, json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
    headers: new Headers(),
    statusText: status === 200 ? "OK" : "Error",
    redirected: false,
    type: "basic",
    url: "",
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
  } as Response);
}

function mockFetchError(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

// ── 测试 ──────────────────────────────────────────────

describe("mimo_web_search 工具", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 工具注册 ─────────────────────────────────────

  it("工具名称为 mimo_web_search", () => {
    expect(capturedToolName).toBe("mimo_web_search");
  });

  it("handler 已注册", () => {
    expect(capturedHandler).toBeDefined();
    expect(typeof capturedHandler).toBe("function");
  });

  // ── 正常搜索 ─────────────────────────────────────

  it("正常搜索返回格式化结果", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson(200, {
        choices: [
          {
            message: {
              content: "搜索结果内容",
              annotations: [
                {
                  title: "测试标题",
                  url: "https://example.com",
                  site_name: "Example",
                  publish_time: "2025-01-01",
                },
              ],
            },
          },
        ],
        usage: {
          total_tokens: 200,
          prompt_tokens: 100,
          completion_tokens: 100,
          web_search_usage: { tool_usage: 2, page_usage: 5 },
        },
      }),
    );

    const result = (await callHandler({
      query: "测试查询",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("搜索结果内容");
    expect(result.content[0].text).toContain("Sources");
    expect(result.content[0].text).toContain("测试标题");
    expect(result.content[0].text).toContain("https://example.com");
  });

  it("无引用来源时不添加 Sources 部分", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson(200, {
        choices: [{ message: { content: "纯文本结果" } }],
        usage: {},
      }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { content: Array<{ text: string }> };

    expect(result.content[0].text).toContain("纯文本结果");
    expect(result.content[0].text).not.toContain("Sources");
  });

  it("空内容显示 (no content)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson(200, {
        choices: [{ message: { content: "" } }],
        usage: {},
      }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { content: Array<{ text: string }> };

    expect(result.content[0].text).toContain("(no content)");
  });

  // ── 请求参数构造 ─────────────────────────────────

  it("请求体包含正确的参数", async () => {
    const fetchMock = mockFetchJson(200, {
      choices: [{ message: { content: "ok" } }],
      usage: {},
    });
    vi.stubGlobal("fetch", fetchMock);

    await callHandler({
      query: "搜索词",
      max_keyword: 5,
      limit: 10,
      force_search: false,
      country: "China",
      region: "Hubei",
      city: "Wuhan",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers["api-key"]).toBe("test-api-key");

    const body = JSON.parse(options.body);
    expect(body.model).toBe("mimo-v2.5-pro");
    expect(body.messages[0].content).toBe("搜索词");
    expect(body.tools[0].type).toBe("web_search");
    expect(body.tools[0].max_keyword).toBe(5);
    expect(body.tools[0].limit).toBe(10);
    expect(body.tools[0].force_search).toBe(false);
    expect(body.tools[0].user_location).toEqual({
      type: "approximate",
      country: "China",
      region: "Hubei",
      city: "Wuhan",
    });
  });

  it("不传位置参数时无 user_location", async () => {
    const fetchMock = mockFetchJson(200, {
      choices: [{ message: { content: "ok" } }],
      usage: {},
    });
    vi.stubGlobal("fetch", fetchMock);

    await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0].user_location).toBeUndefined();
  });

  // ── HTTP 错误处理 ────────────────────────────────

  it("401 返回认证错误", async () => {
    vi.stubGlobal("fetch", mockFetchJson(401, { error: "Unauthorized" }));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Authentication failed");
  });

  it("403 返回认证错误", async () => {
    vi.stubGlobal("fetch", mockFetchJson(403, { error: "Forbidden" }));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Authentication failed");
  });

  it("429 重试后返回限流错误", async () => {
    // 所有重试都返回 429
    vi.stubGlobal("fetch", mockFetchJson(429, { error: "Rate limited" }));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Rate limit exceeded");
  });

  it("500 重试后返回服务不可用", async () => {
    vi.stubGlobal("fetch", mockFetchJson(500, { error: "Internal Server Error" }));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("temporarily unavailable");
  });

  it("400 返回参数错误", async () => {
    vi.stubGlobal("fetch", mockFetchJson(400, { error: "Bad Request" }));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 400");
  });

  // ── 重试逻辑 ─────────────────────────────────────

  it("429 成功恢复后返回结果", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            text: async () => "Rate limited",
            headers: new Headers(),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "恢复后的结果" } }],
            usage: {},
          }),
          text: async () => "",
          headers: new Headers(),
        } as Response;
      }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("恢复后的结果");
    expect(callCount).toBe(2);
  });

  it("500 成功恢复后返回结果", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            text: async () => "Server Error",
            headers: new Headers(),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "恢复" } }],
            usage: {},
          }),
          text: async () => "",
          headers: new Headers(),
        } as Response;
      }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(callCount).toBe(2);
  });

  // ── 网络错误 ─────────────────────────────────────

  it("超时返回超时错误", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", mockFetchError(abortError));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timed out");
  });

  it("ECONNRESET 重试后成功", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("socket hang up") as NodeJS.ErrnoException;
          err.code = "ECONNRESET";
          throw err;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "重试成功" } }],
            usage: {},
          }),
          text: async () => "",
          headers: new Headers(),
        } as Response;
      }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("重试成功");
  });

  it("ENOTFOUND 不重试，直接返回错误", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      const err = new Error("getaddrinfo failed") as NodeJS.ErrnoException;
      err.code = "ENOTFOUND";
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network error");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("未知网络错误不重试", async () => {
    vi.stubGlobal("fetch", mockFetchError(new Error("Unknown failure")));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network error");
  });

  // ── 响应格式异常 ─────────────────────────────────

  it("空 choices 返回错误", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson(200, { choices: [], usage: {} }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No response received");
  });

  it("无 choices 字段返回错误", async () => {
    vi.stubGlobal("fetch", mockFetchJson(200, { usage: {} }));

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { isError: boolean };

    expect(result.isError).toBe(true);
  });

  // ── 内容截断 ─────────────────────────────────────

  it("超长内容被截断", async () => {
    const longContent = "x".repeat(200000);
    vi.stubGlobal(
      "fetch",
      mockFetchJson(200, {
        choices: [{ message: { content: longContent } }],
        usage: {},
      }),
    );

    const result = (await callHandler({
      query: "test",
      max_keyword: 3,
      limit: 5,
      force_search: true,
    })) as { content: Array<{ text: string }> };

    expect(result.content[0].text.length).toBeLessThan(longContent.length);
    expect(result.content[0].text).toContain("Content truncated");
  });

  // ── MCP Client 取消信号 ────────────────────────────

  it("MCP client 取消信号中止进行中的 fetch 请求", async () => {
    const abortController = new AbortController();
    let fetchSignal: AbortSignal | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
        fetchSignal = options.signal;
        // 模拟慢请求，等待信号中止
        return new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );

    // 请求发出后、50ms 后取消——模拟 MCP client 断开
    setTimeout(() => abortController.abort(), 50);

    const result = (await callHandler(
      {
        query: "test",
        max_keyword: 3,
        limit: 5,
        force_search: true,
      },
      abortController.signal,
    )) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timed out");
    // 验证 fetch 收到了合并后的 abort signal
    expect(fetchSignal).toBeDefined();
    expect(fetchSignal!.aborted).toBe(true);
  });
});
