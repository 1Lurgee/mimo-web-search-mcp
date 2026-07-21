/** HTML 转 Markdown 模块 - 基于 linkedom + Readability + Turndown */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── Base64 Data URI 剥离 ──────────────────────────────

/**
 * 剥离内容中的 base64 data URI，防止 token 浪费
 *
 * grok-build 设计：使用手动扫描而非正则，性能更好且避免回溯问题
 * 匹配模式：data:<mime>;base64,<payload>
 * 输出：[base64 <mime> data removed]
 */
export function stripBase64DataUris(content: string): string {
  const MIN_BASE64_PAYLOAD = 4;
  const MAX_HEADER_LEN = 120;

  if (!content.includes("data:")) return content;

  const s = content;
  let result = "";
  let lastEnd = 0;
  let searchFrom = 0;

  while (searchFrom < s.length) {
    const relIdx = s.indexOf("data:", searchFrom);
    if (relIdx === -1) break;

    const start = relIdx;

    // "data:" 必须是 URI scheme 开头，不能是单词的一部分（如 "metadata:"）
    if (start > 0 && /[a-zA-Z0-9]/.test(s[start - 1])) {
      searchFrom = start + 5;
      continue;
    }

    const commaIdx = s.indexOf(",", start);
    if (commaIdx === -1) {
      searchFrom = start + 5;
      continue;
    }

    const header = s.substring(start + 5, commaIdx);

    // RFC 2397 禁止 header 中有空白，且 header 应该是短 ASCII
    if (header.length > MAX_HEADER_LEN || /\s/.test(header)) {
      searchFrom = start + 5;
      continue;
    }

    const parts = header.split(";");
    const mime = parts[0] || "unknown";
    const hasBase64 = parts.some((p) => p.toLowerCase() === "base64");

    if (!hasBase64) {
      searchFrom = start + 5;
      continue;
    }

    // 消费逗号后的 base64 字符
    const payloadStart = commaIdx + 1;
    let payloadLen = 0;
    while (payloadStart + payloadLen < s.length) {
      const ch = s[payloadStart + payloadLen];
      if (
        (ch >= "A" && ch <= "Z") ||
        (ch >= "a" && ch <= "z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "+" ||
        ch === "/" ||
        ch === "="
      ) {
        payloadLen++;
      } else {
        break;
      }
    }

    if (payloadLen >= MIN_BASE64_PAYLOAD) {
      result += s.substring(lastEnd, start);
      result += `[base64 ${mime} data removed]`;
      lastEnd = payloadStart + payloadLen;
      searchFrom = lastEnd;
      continue;
    }

    searchFrom = start + 5;
  }

  if (lastEnd === 0) return content;
  result += s.substring(lastEnd);
  return result;
}

/** HTML 转 Markdown 选项 */
export interface ConvertOptions {
  /** 是否启用 Readability 内容提取（默认 true） */
  clean?: boolean;
  /** 输出最大字符数（默认 50000） */
  maxLength?: number;
}

// ── Turndown 配置 ─────────────────────────────────────

/** 创建预配置的 TurndownService 实例 */
function createTurndownService(): TurndownService {
  return new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
}

// ── 内部工具函数 ──────────────────────────────────────

/**
 * linkedom parseHTML 返回的 document 对象的最小接口
 * 仅声明 removeNoiseElements 实际使用的方法，避免引入完整 DOM lib
 */
/** linkedom parseHTML 返回的 document 对象的最小接口 */
interface LinkedomDocument {
  querySelectorAll(selectors: string): Iterable<{ remove(): void }>;
}

/**
 * 从 DOM 中移除无关元素（script/style/noscript/svg/iframe）
 * 减少噪声，保留可读内容
 * @param document - linkedom parseHTML 返回的 document 对象
 */
function removeNoiseElements(document: LinkedomDocument): void {
  const selectors = "script, style, noscript, svg, iframe";
  for (const el of document.querySelectorAll(selectors)) {
    el.remove();
  }
}

/**
 * 截断过长内容，按段落/换行/句子边界截断，避免破坏语义结构
 * 复用 search.ts 的 truncateContent 逻辑
 */
function truncateMarkdown(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const truncationNotice = "\n\n[Content truncated due to size limit...]";

  // 依次尝试按段落、换行、句号截断，保留最完整的语义单元
  const boundaries = ["\n\n", "\n", ". "];
  let cutPoint = -1;
  for (const boundary of boundaries) {
    const idx = truncated.lastIndexOf(boundary);
    if (idx > maxLength / 2) {
      cutPoint = idx + boundary.length;
      break;
    }
  }

  // 无合适边界，硬截断
  const base = cutPoint >= 0 ? truncated.substring(0, cutPoint).trimEnd() : truncated;

  // 修复截断可能破坏的 Markdown 链接：移除末尾不完整的 [text 片段
  if (!base.includes("](")) {
    return base.replace(/\[[^\]]*$/, "") + truncationNotice;
  }

  return base + truncationNotice;
}

/**
 * 使用 Turndown 将 HTML 字符串转换为 Markdown
 */
function convertHtmlToMd(html: string): string {
  const turndown = createTurndownService();
  return turndown.turndown(html);
}

// ── 公开 API ─────────────────────────────────────────

/**
 * 将 HTML 转换为 Markdown
 *
 * Clean 模式（默认）：
 *   1. 用 Readability 提取正文
 *   2. 提取失败或内容过短 -> 去噪后用 body 转换
 *   3. 结果仍过短 -> 返回警告 + 原始片段
 *
 * 非 Clean 模式：
 *   直接去噪后转换整个文档
 *
 * @param html - 原始 HTML 字符串
 * @param options - 转换选项
 * @returns Markdown 文本
 */
export function htmlToMarkdown(html: string, options?: ConvertOptions): string {
  const { clean = true, maxLength = 50000 } = options ?? {};

  logger.debug(`开始 HTML 转 Markdown，clean=${clean}, 输入长度=${html.length}`);

  let markdown: string;
  if (clean) {
    markdown = cleanConvert(html, maxLength);
  } else {
    markdown = rawConvert(html, maxLength);
  }

  // 剥离 base64 data URI，防止 token 浪费
  markdown = stripBase64DataUris(markdown);

  return markdown;
}

/**
 * Clean 模式：Readability 提取 + 三级降级策略
 */
function cleanConvert(html: string, maxLength: number): string {
  const { document } = parseHTML(html);

  // ── 第一级：Readability 提取正文 ──
  try {
    const reader = new Readability(document);
    const article = reader.parse();

    if (article && article.content && article.content.length >= 50) {
      logger.debug(`Readability 提取成功，内容长度=${article.content.length}`);
      const md = convertHtmlToMd(article.content);
      if (md.length >= 100) {
        return truncateMarkdown(md, maxLength);
      }
      logger.debug("Readability 结果转 Markdown 后过短，降级到 body");
    } else {
      logger.debug("Readability 结果为空或过短，降级到 body");
    }
  } catch (err) {
    logger.debug("Readability 解析异常，降级到 body:", err instanceof Error ? err.message : err);
  }

  // ── 第二级：去噪后用 body 转换 ──
  try {
    // 重新解析：Readability 可能已修改 document，需要干净的 DOM
    const { document: freshDoc } = parseHTML(html);
    removeNoiseElements(freshDoc);

    const bodyHtml = freshDoc.querySelector("body")?.innerHTML ?? freshDoc.documentElement.innerHTML;
    const md = convertHtmlToMd(bodyHtml);

    if (md.length >= 100) {
      logger.debug(`Body 降级转换成功，内容长度=${md.length}`);
      return truncateMarkdown(md, maxLength);
    }
  } catch (err) {
    logger.debug("Body 降级转换异常:", err instanceof Error ? err.message : err);
  }

  // ── 第三级：返回警告 + 原始片段 ──
  logger.warn("所有转换策略均失败，返回原始片段");
  const snippet = html.replace(/<[^>]*>/g, "").substring(0, 500).trim();
  return `Web page content is too short or heavily relies on JavaScript rendering. Fetched content: ${snippet}`;
}

/**
 * 非 Clean 模式：去噪后直接转换整个文档
 */
function rawConvert(html: string, maxLength: number): string {
  const { document } = parseHTML(html);
  removeNoiseElements(document);

  const fullHtml = document.documentElement.outerHTML;
  const md = convertHtmlToMd(fullHtml);
  return truncateMarkdown(md, maxLength);
}
