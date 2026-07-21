/**
 * URL 验证模块（本地使用简化版）
 *
 * 设计原则：本地部署、本地用户使用
 * - 允许访问 localhost、私有 IP、任意端口
 * - 允许包含凭证的 URL
 * - 仅保留基础验证：协议、URL 格式、长度
 */

// ── 常量 ─────────────────────────────────────────────────

/** URL 最大长度限制 */
const MAX_URL_LENGTH = 8192;

// ── URL 验证 ──────────────────────────────────────────

/**
 * 验证 URL 合法性
 * - 仅允许 http/https 协议
 * - URL 长度限制
 * - 允许访问 localhost、私有 IP、任意端口、包含凭证的 URL
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  // URL 长度限制
  if (url.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `URL 过长（${url.length} 字符，最大 ${MAX_URL_LENGTH}）`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: `无效的 URL 格式: ${url}` };
  }

  // 仅允许 http 和 https 协议
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `不支持的协议: ${parsed.protocol}（仅允许 http/https）`,
    };
  }

  return { valid: true };
}

/**
 * 兼容旧代码的空实现
 * @deprecated 本地使用不需要 DNS rebinding 防护
 */
export async function resolveAndCheckHost(_url: string): Promise<string | null> {
  return null;
}
