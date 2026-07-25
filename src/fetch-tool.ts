/** 网页抓取工具 - MCP 工具层（validate -> fetch -> convert -> AI 处理） */

import { randomUUID } from "node:crypto";
import { fetchPage } from "./fetch.js";
import { validateUrl, redactUrl } from "./ssrf.js";
import { htmlToMarkdown } from "./convert.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { MimoResponseSchema, type FetchParams } from "./types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fetchWithTimeout, truncateMarkdown, TIMEOUT_REASON } from "./util.js";
import { isSpaPage, renderWithBrowser, getSpaHint } from "./render.js";
import { handleOverflow } from "./overflow.js";
import { emit401 } from "./attribution.js";
import type { ProgressReporter } from "./progress.js";

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
  header += `URL: ${redactUrl(url)}\n`;
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
 * 1. 验证 URL（协议 / 格式 / 长度；本地部署允许私有 IP）
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
  reporter?: ProgressReporter,
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
  log.info(`开始抓取: ${redactUrl(url)}`);
  await reporter?.report(0, "正在抓取网页...");
  const result = await fetchPage(url, { signal });

  if (result.error) {
    log.error(`抓取失败: ${result.error}`);
    return {
      content: [{ type: "text", text: `网页抓取失败: ${result.error}` }],
      isError: true,
    };
  }

  log.info(`抓取成功: ${result.status}, ${result.size} 字节, Content-Type: ${result.contentType}`);
  await reporter?.report(16, "抓取成功，正在转换...");

  // ── 3. 非 HTML 内容 -> 直接返回原始文本 ──
  const isHtml = result.contentType?.includes("html") ?? false;
  if (!isHtml) {
    const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, false);
    // 超长内容做智能截断（本地工具不落盘）
    const overflow = await handleOverflow(result.content, maxLength);
    return {
      content: [{ type: "text", text: metadata + overflow.content }],
    };
  }

  // ── 4. HTML -> Markdown ──
  log.info("开始 HTML 转 Markdown...");
  await reporter?.report(33, "正在提取正文...");
  let markdown = htmlToMarkdown(result.content, { clean, maxLength });
  log.info(`Markdown 转换完成，长度: ${markdown.length}`);

  // ── 4.1 SPA 降级检测 ──
  if (clean && isSpaPage(result.content, markdown.length)) {
    log.info("检测到疑似 SPA 页面");
    await reporter?.report(50, "检测到 SPA，正在渲染...");
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

    // 内容在限制内，直接返回
    if (markdown.length <= maxLength) {
      return {
        content: [{ type: "text", text: metadata + markdown }],
      };
    }

    // 内容超长 + 自动摘要已启用 -> 调用 MiMo API 摘要（对齐 Claude Code Haiku 摘要设计）
    if (config.autoSummary) {
      log.info(`内容超长（${markdown.length} > ${maxLength}），启用自动摘要...`);
      await reporter?.report(83, "内容超长，正在自动摘要...");
      const summaryPrompt = "请对以下网页内容进行简洁的摘要，保留关键信息、代码示例和文档要点。";
      // 截断到安全上限再发给模型（对齐 Claude Code 的 MAX_MARKDOWN_LENGTH = 100K）
      // 防止 maxLength 配置过大时超出模型 context window
      // 使用语义边界截断，避免在段落/句子中间切断
      const SUMMARY_INPUT_LIMIT = 100_000;
      const contentForSummary = truncateMarkdown(markdown, SUMMARY_INPUT_LIMIT);
      const aiResult = await callMimoApi(contentForSummary, summaryPrompt, signal, reqId);

      if (aiResult.success) {
        log.info(`自动摘要完成，长度: ${aiResult.content.length}`);
        const summaryMetadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, true);
        await reporter?.report(100, "完成");
        return {
          content: [{ type: "text", text: summaryMetadata + aiResult.content }],
        };
      }

      // 摘要失败 -> fallback 到硬截断 + 附加警告
      log.warn(`自动摘要失败: ${aiResult.error}，回退到硬截断`);
      const overflow = await handleOverflow(markdown, maxLength);
      await reporter?.report(100, "完成（摘要失败，已截断）");
      return {
        content: [{ type: "text", text: metadata + overflow.content + `\n\n[注意：自动摘要失败（${aiResult.error}），内容已截断]` }],
      };
    }

    // 自动摘要未启用 -> 硬截断
    const overflow = await handleOverflow(markdown, maxLength);
    await reporter?.report(100, "完成");
    return {
      content: [{ type: "text", text: metadata + overflow.content }],
    };
  }

  // ── 6. 有 prompt -> 调用 MiMo API ──
  log.info(`开始 AI 分析，prompt: ${prompt.substring(0, 50)}...`);
  await reporter?.report(83, "正在 AI 分析...");
  const aiResult = await callMimoApi(markdown, prompt, signal, reqId);

  if (!aiResult.success) {
    // AI 分析失败 -> 返回错误 + 原始 Markdown 作为 fallback（经过 overflow 保护）
    log.warn(`AI 分析失败: ${aiResult.error}，返回原始 Markdown`);
    const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, false);
    const overflow = await handleOverflow(markdown, maxLength);
    const fallbackText = `${metadata}**AI 分析失败: ${aiResult.error}**\n\n以下是原始网页内容：\n\n${overflow.content}`;
    return {
      content: [{ type: "text", text: fallbackText }],
      isError: true,
    };
  }

  // AI 分析成功 -> 返回分析结果
  const metadata = formatMetadataHeader(result.url, result.status, result.contentType, result.size, true);
  await reporter?.report(100, "完成");
  return {
    content: [{ type: "text", text: metadata + aiResult.content }],
  };
}
