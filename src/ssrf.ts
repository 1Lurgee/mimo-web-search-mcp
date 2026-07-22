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

// ── 重定向安全检查 ──────────────────────────────────────

/**
 * 检查重定向是否安全可跟随（对齐 Claude Code isPermittedRedirect 设计）
 *
 * 允许的重定向必须同时满足 4 个条件：
 * 1. 协议一致（防止 HTTPS -> HTTP 降级）
 * 2. 端口一致（防止端口扫描/内部服务访问）
 * 3. 无凭证（防止 user:pass@ 信息泄漏）
 * 4. 主机名一致（允许 www 前缀增减）
 *
 * 防止开放重定向攻击：恶意服务器通过 302 将请求导向内网或钓鱼站点
 */
export function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const parsedOriginal = new URL(originalUrl);
    const parsedRedirect = new URL(redirectUrl);

    // 条件 1：协议必须一致（防止 TLS 降级）
    if (parsedRedirect.protocol !== parsedOriginal.protocol) {
      return false;
    }

    // 条件 2：端口必须一致（防止端口扫描）
    if (parsedRedirect.port !== parsedOriginal.port) {
      return false;
    }

    // 条件 3：重定向 URL 不能携带凭证（防止信息泄漏）
    if (parsedRedirect.username || parsedRedirect.password) {
      return false;
    }

    // 条件 4：主机名一致（允许 www 前缀增减）
    const stripWww = (hostname: string) => hostname.replace(/^www\./, "");
    return stripWww(parsedOriginal.hostname) === stripWww(parsedRedirect.hostname);
  } catch {
    return false;
  }
}
