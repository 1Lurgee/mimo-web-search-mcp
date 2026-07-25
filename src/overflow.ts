/**
 * 内容溢出处理：超长 Markdown/文本的智能截断。
 * 本地单用户场景不落盘；后续若需其它策略可在此扩展。
 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { truncateMarkdown } from "./util.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── 类型定义 ──────────────────────────────────────────

/** 溢出处理结果 */
export interface OverflowResult {
  /** 内联内容（可能被截断） */
  content: string;
  /** 内容是否被截断 */
  wasTruncated: boolean;
}

// ── 溢出处理 ──────────────────────────────────────────

/**
 * 处理内容溢出
 * 本地使用：仅智能截断，不保存到磁盘
 *
 * @param content - 原始内容
 * @param maxLength - 最大内联长度
 * @returns 溢出处理结果
 */
export async function handleOverflow(
  content: string,
  maxLength: number,
): Promise<OverflowResult> {
  // 内容长度在限制内，直接返回
  if (content.length <= maxLength) {
    return {
      content,
      wasTruncated: false,
    };
  }

  logger.info(`内容溢出: ${content.length} 字符 > ${maxLength} 字符限制`);

  // 使用共享的语义边界截断（含 Markdown 链接修复）
  return {
    content: truncateMarkdown(content, maxLength),
    wasTruncated: true,
  };
}
