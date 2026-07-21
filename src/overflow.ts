/**
 * 内容溢出处理模块（简化版）
 *
 * 本地使用简化：
 * - 移除保存到磁盘功能（用户有文件系统访问能力）
 * - 仅保留智能截断
 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

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

  // 智能截断：按语义边界截断
  const truncated = content.substring(0, maxLength);
  const truncationNotice = "\n\n[Content truncated due to size limit...]";

  // 按语义边界截断
  const boundaries = ["\n\n", "\n", ". "];
  let cutPoint = -1;
  for (const boundary of boundaries) {
    const idx = truncated.lastIndexOf(boundary);
    if (idx > maxLength / 2) {
      cutPoint = idx + boundary.length;
      break;
    }
  }

  const base = cutPoint >= 0 ? truncated.substring(0, cutPoint).trimEnd() : truncated;

  return {
    content: base + truncationNotice,
    wasTruncated: true,
  };
}
