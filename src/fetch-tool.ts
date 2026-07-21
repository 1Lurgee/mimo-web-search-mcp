/** 网页抓取工具 - MCP 工具层（validate -> fetch -> convert -> AI 处理） */

import { randomUUID } from "node:crypto";
import { fetchPage } from "./fetch.js";
import { validateUrl } from "./ssrf.js";
import { htmlToMarkdown } from "./convert.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { MimoResponseSchema, type FetchParams } from "./types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fetchWithTimeout, TIMEOUT_REASON } from "./util.js";
import { isSpaPage, renderWithBrowser, getSpaHint } from "./render.js";
import { handleOverflow } from "./overflow.js";
import { emit401 } from "./attribution.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── HTTP 客户端（共用工具已迁移至 ./util.ts）──────────

// ── 元数据头格式化 ─────────────────────────────────────

/**
 * 生成元数据头
 * 用于标识抓取结果的来源和属性
 */
function formatMetadataHeader(
  url: string,
  status: number,
  contentType: string | null,
  size: number,
  aiProcessed: boolean,
): string {
  let header = `--- Web Fetch Result ---\n`;
  header += `URL: ${url}\n`;
  header += `Status: ${status}\n`;
  header += `Content-Type: ${contentType ?? "unknown"}\n`;
  header += `Size: ${size} bytes\n`;
  header += `Fetched at: ${new Date().toISOString()}\n`;
  if (aiProcessed) {
    header += `Mode: AI processed\n`;
  }
  header += `---\n\n`;
  return header;
}

// ── AI 处理（调用 MiMo API）────────────────────────────

/**
 * 调用 MiMo API 对抓取的 Markdown 内容进行 AI 分析
 * 使用与 search.ts 相同的 API 模式
 */
async function callMimoApi(
  markdown: string,
  prompt: string,
  signal?: AbortSignal,
  reqId?: string,
): Promise<{ success: true; content: string } | { success: false; error: string }> {
  const log = reqId ? logger.withReqId(reqId) : logger;

  const body = {
    model: config.model,
    messages: [
      {
        role: "system" as const,
        content: "你是一个网页内容分析助手。请根据用户的要求分析以下网页内容。",
      },
      {
        role: "user" as const,
        content: `## 网页内容\n\n${markdown}\n\n---\n\n## 用户要求\n\n${prompt}`,
      },
    ],
    max_completion_tokens: config.maxCompletionTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stream: false,
    thinking: { type: config.thinking ? "enabled" as const : "disabled" as const },
  };

  if (log.isDebugEnabled()) {
    log.debug("MiMo API request body:", JSON.stringify(body, null, 2));
  }

  try {
    log.info("调用 MiMo API 进行内容分析...");

    const resp = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      config.requestTimeout,
      signal,
    );

    log.info(`MiMo API 响应状态: ${resp.status}`);

    if (!resp.ok) {
      await resp.text().catch(() => "");
      // 记录 401 归因事件（借鉴 grok-build 设计）
      if (resp.status === 401) {
        emit401("MiMoAPI", config.apiKey, { status: resp.status });
      }
      return { success: false, error: `MiMo API 请求失败 (HTTP ${resp.status})` };
    }

    const rawData: unknown = await resp.json();
    if (log.isDebugEnabled()) {
      log.debug("MiMo API response:", JSON.stringify(rawData, null, 2));
    }

    const parsed = MimoResponseSchema.safeParse(rawData);
    if (!parsed.success) {
      log.error("MiMo API 响应校验失败:", parsed.error.message);
      return { success: false, error: "MiMo API 返回了无效的响应格式" };
    }

    const message = parsed.data.choices?.[0]?.message;
    if (!message?.content) {
      return { success: false, error: "MiMo API 返回了空响应" };
    }

    log.info(`AI 分析完成，内容长度: ${message.content.length}`);
    return { success: true, content: message.content };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    if (error.name === "AbortError") {
      const cause = "cause" in error ? (error as { cause: unknown }).cause : undefined;
      const isTimeout = cause === TIMEOUT_REASON;
      return {
        success: false,
        error: isTimeout ? "MiMo API 请求超时" : "请求被取消",
      };
    }

    return { success: false, error: `MiMo API 请求异常: ${error.message}` };
  }
}

// ── 主函数 ─────────────────────────────────────────────

/**
 * 执行网页抓取
 *
 * 流程：
 * 1. 验证 URL（协议 + SSRF 防护）
 * 2. 抓取网页内容
 * 3. 非 HTML 内容 -> 直接返回原始文本
 * 4. HTML 内容 -> 转换为 Markdown
 * 5. 无 prompt -> 返回 Markdown
 * 6. 有 prompt -> 调用 MiMo API 进行 AI 分析
 */
export async function executeFetch(
  params: FetchParams,
  signal?: AbortSignal,
  reqId: string = randomUUID(),
): Promise<CallToolResult> {
  const log = logger.withReqId(reqId);
  const { url, prompt, clean, maxLength } = params;

  // ── 1. URL 验证 ──
  const validation = validateUrl(url);
  if (!validation.valid) {
    return {
      content: [{ type: "text", text: `URL 验证失败: ${validation.error}` }],
      isError: true,
    };
  }

  // ── 2. 抓取网页 ──
  log.info(`开始抓取: ${url}`);
  const result = await fetchPage(url, { signal });

  if (result.error) {
    log.error(`抓取失败: ${result.error}`);
    return {
      content: [{ type: "text", text: `网页抓取失败: ${result.error}` }],
      isError: true,
    };
  }

  log.info(`抓取成功: ${result.status}, ${result.size} 字节, Content-Type: ${result.contentType}`);

  // ── 3. 非 HTML 内容 -> 直接返回原始文本 ──
  const isHtml = result.contentType?.includes("html") ?? false;
  if (!isHtml) {
    const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, false);
    // 使用溢出处理，支持大文件保存到磁盘
    const overflow = await handleOverflow(result.content, maxLength);
    return {
      content: [{ type: "text", text: metadata + overflow.content }],
    };
  }

  // ── 4. HTML -> Markdown ──
  log.info("开始 HTML 转 Markdown...");
  let markdown = htmlToMarkdown(result.content, { clean, maxLength });
  log.info(`Markdown 转换完成，长度: ${markdown.length}`);

  // ── 4.1 SPA 降级检测 ──
  if (clean && isSpaPage(result.content, markdown.length)) {
    log.info("检测到疑似 SPA 页面");
    if (config.enableBrowser) {
      log.info("启用浏览器渲染降级...");
      const rendered = await renderWithBrowser(url);
      if (rendered.success && rendered.html) {
        // 用渲染后的 HTML 重新提取 Markdown
        markdown = htmlToMarkdown(rendered.html, { clean, maxLength });
        log.info(`浏览器渲染后 Markdown 长度: ${markdown.length}`);
      } else {
        log.warn(`浏览器渲染失败: ${rendered.error}`);
        markdown += `\n\n**浏览器渲染失败**: ${rendered.error}`;
      }
    } else {
      // 浏览器未启用，附加提示
      markdown += getSpaHint();
    }
  }

  // ── 5. 无 prompt -> 返回 Markdown ──
  if (!prompt) {
    const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, false);
    // 使用溢出处理，支持大文件保存到磁盘
    const overflow = await handleOverflow(markdown, maxLength);
    return {
      content: [{ type: "text", text: metadata + overflow.content }],
    };
  }

  // ── 6. 有 prompt -> 调用 MiMo API ──
  log.info(`开始 AI 分析，prompt: ${prompt.substring(0, 50)}...`);
  const aiResult = await callMimoApi(markdown, prompt, signal, reqId);

  if (!aiResult.success) {
    // AI 分析失败 -> 返回错误 + 原始 Markdown 作为 fallback
    log.warn(`AI 分析失败: ${aiResult.error}，返回原始 Markdown`);
    const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, false);
    const fallbackText = `${metadata}**AI 分析失败: ${aiResult.error}**\n\n以下是原始网页内容：\n\n${markdown}`;
    return {
      content: [{ type: "text", text: fallbackText }],
      isError: true,
    };
  }

  // AI 分析成功 -> 返回分析结果
  const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, true);
  return {
    content: [{ type: "text", text: metadata + aiResult.content }],
  };
}
