/**
 * URL 验证模块（本地使用简化版）
 *
 * 设计原则：本地部署、本地用户使用
 * - 允许访问 localhost、私有 IP、任意端口
 * - 允许包含凭证的 URL（请求侧保留凭证；日志/对外错误请用 redactUrl 脱敏）
 * - 仅保留基础验证：协议、URL 格式、长度
 *
 * 注意：本模块保持纯函数、无 config 依赖，便于单元测试。
 */

// ── 常量 ─────────────────────────────────────────────────

/** URL 最大长度限制 */
const MAX_URL_LENGTH = 8192;

// ── URL 脱敏 ──────────────────────────────────────────

/**
 * 脱敏 URL 中的 userinfo（username/password），用于日志与对外错误信息。
 *
 * 本地部署仍允许带凭证的 URL 发起真实请求；仅避免凭证进入 stderr / 返回文本。
 * - 有凭证：`http://user:pass@host/path` → `http://***:***@host/path`
 * - 无凭证：尽量返回原字符串，避免无意义的规范化改写
 * - 非法 URL：回退为正则剥离 `//...@` 段
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) {
      return url;
    }
    parsed.username = "***";
    parsed.password = "***";
    return parsed.toString();
  } catch {
    // 无法解析时尽量去掉 userinfo，避免原样打印
    return url.replace(/\/\/([^/@\s]+)@/g, "//***@");
  }
}

// ── URL 验证 ──────────────────────────────────────────

/**
 * 验证 URL 合法性
 * - 仅允许 http/https 协议
 * - URL 长度限制
 * - 允许访问 localhost、私有 IP、任意端口、包含凭证的 URL
 * - 错误信息中的 URL 会脱敏，避免凭证泄漏
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
    return { valid: false, error: `无效的 URL 格式: ${redactUrl(url)}` };
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

// ── 主机分类（HTTP→HTTPS 升级决策）──────────────────────

/**
 * 判断 hostname 是否为回环 / 私有 / 链路本地（本机与内网调试地址）。
 * 用于：http 请求是否跳过自动升级为 https。
 */
export function isLocalOrPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;

  // IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    if ([a, b, c, d].some((x) => x > 255)) return false;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10/8
    if (a === 0) return true; // 0.0.0.0/8 本机侧常见
    if (a === 169 && b === 254) return true; // link-local
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    return false;
  }

  // IPv6：链路本地 / 唯一本地（粗匹配，足够本机策略）
  if (h.includes(":")) {
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
    return false;
  }

  return false;
}

// ── 重定向安全检查 ──────────────────────────────────────

/**
 * 检查重定向是否可跟随（本机部署简化版）
 *
 * 允许的重定向必须同时满足：
 * 1. 协议一致（防止 HTTPS -> HTTP 降级）
 * 2. 端口一致
 * 3. 主机名一致（允许 www 前缀增减）
 *
 * 凭证（userinfo）：
 * - 请求侧允许带凭证；相对 Location 经 URL 解析会从 base **继承** userinfo。
 * - 因此**不再**因目标 URL 含 username/password 而拒绝（避免 Basic Auth 同站跳转被误杀）。
 * - 跨主机仍拒绝，不会把凭证跟到其它主机。
 */
export function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const parsedOriginal = new URL(originalUrl);
    const parsedRedirect = new URL(redirectUrl);

    // 条件 1：协议必须一致（防止 TLS 降级）
    if (parsedRedirect.protocol !== parsedOriginal.protocol) {
      return false;
    }

    // 条件 2：端口必须一致
    if (parsedRedirect.port !== parsedOriginal.port) {
      return false;
    }

    // 条件 3：主机名一致（允许 www 前缀增减）
    // 不检查 userinfo：相对重定向会继承 base 凭证，拒绝会破坏本地 Basic Auth 流程
    const stripWww = (hostname: string) => hostname.replace(/^www\./, "");
    return stripWww(parsedOriginal.hostname) === stripWww(parsedRedirect.hostname);
  } catch {
    return false;
  }
}
