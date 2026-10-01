/** 网页抓取模块 - HTTP fetch 用于获取网页内容 */

import os from "node:os";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { validateUrl, isPermittedRedirect, redactUrl, isLocalOrPrivateHostname } from "./ssrf.js";
import { mergeAbortSignals, TIMEOUT_REASON } from "./util.js";
import { globalFetchCache } from "./cache.js";
import { detectCharset, hasGbkSupport } from "./charset.js";
import { isBinaryContentType, streamToLimitedBuffer } from "./stream.js";

// 重新导出 charset 检测函数（保持向后兼容）
export { detectCharset, hasGbkSupport } from "./charset.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── 动态 User-Agent（防止 WAF 拦截）──────────────────

/**
 * 按 OS 分组的真实浏览器 UA 池
 * 每个 UA 都是真实存在的浏览器指纹，版本号固定（过时后手动更新）
 */
const UA_POOLS: Record<string, string[]> = {
  win32: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  ],
  darwin: [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  ],
  linux: [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  ],
};

/**
 * 获取随机 User-Agent（会话级单例）
 * 根据真实 OS 环境从对应 UA 池中随机选取一个，整个 MCP 生命周期复用
 */
let _cachedUA: string | null = null;
function getUserAgent(): string {
  if (_cachedUA) return _cachedUA;
  const platform = os.platform();
  const pool = UA_POOLS[platform] ?? UA_POOLS["win32"];
  _cachedUA = pool[Math.floor(Math.random() * pool.length)];
  return _cachedUA;
}


// ── In-flight 请求去重 ─────────────────────────────────
// 防止 AI 并发触发对同一 URL 的多次抓取，复用进行中的 Promise
const inflightRequests = new Map<string, Promise<FetchPageResult>>();

// ── 类型定义 ──────────────────────────────────────────

/** fetchPage 选项 */
export interface FetchPageOptions {
  /** 外部中止信号（MCP client 取消时触发） */
  signal?: AbortSignal;
  /** 响应体最大字节数，默认从配置读取 */
  maxSize?: number;
  /** 请求超时时间（毫秒），默认从配置读取 */
  timeout?: number;
}

/** fetchPage 返回结果 */
export interface FetchPageResult {
  /** 最终请求的 URL（可能因重定向而变化） */
  url: string;
  /** HTTP 状态码 */
  status: number;
  /** Content-Type 头 */
  contentType: string | null;
  /** 响应体字节数 */
  size: number;
  /** 解码后的文本内容 */
  content: string;
  /** 错误信息（存在时表示请求失败） */
  error?: string;
}

// ── URL 校验（核心逻辑已抽至 ./ssrf.ts；本地部署简化策略）──
// ── 编码检测已抽至 ./charset.ts ──────────────────────
// ── 流式读取 / 二进制检测已抽至 ./stream.ts ──────────

// ── HTTP 请求（mergeAbortSignals 已迁移至 ./util.ts）──

/** 最大重定向次数，防止无限重定向循环（对齐 Claude Code，匹配常见客户端默认值） */
const MAX_REDIRECTS = 10;

/**
 * 内部实现：执行单次 HTTP 请求并处理响应
 * 重定向通过递归调用自身处理，redirectCount 限制重定向深度
 */
async function fetchPageInternal(
  url: string,
  options: FetchPageOptions,
  redirectCount: number,
): Promise<FetchPageResult> {
  const { signal, maxSize = config.maxFetchSize, timeout = config.fetchTimeout } = options;
  const log = logger;

  // URL 基础验证（协议 / 格式 / 长度；本地部署允许私有 IP 与任意端口）
  const validation = validateUrl(url);
  if (!validation.valid) {
    return {
      url,
      status: 0,
      contentType: null,
      size: 0,
      content: "",
      error: validation.error,
    };
  }

  // HTTP → HTTPS：仅对公网主机升级；localhost / 私有 IP / 链路本地保持 http，
  // 以便本机与内网只监听明文 HTTP 的开发服务可抓取。
  let upgradedUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" && !isLocalOrPrivateHostname(parsed.hostname)) {
      parsed.protocol = "https:";
      upgradedUrl = parsed.toString();
      log.info(`HTTP 自动升级为 HTTPS: ${redactUrl(url)} -> ${redactUrl(upgradedUrl)}`);
    }
  } catch {
    // URL 已通过 validateUrl 校验，不会到这里
  }

  // 超时控制：创建内部 AbortController，与外部信号合并
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(TIMEOUT_REASON), timeout);

  const combinedSignal = signal
    ? mergeAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    log.info(`抓取网页: ${redactUrl(upgradedUrl)}`);

    const resp = await fetch(upgradedUrl, {
      method: "GET",
      headers: {
        "User-Agent": getUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: combinedSignal,
      // 不自动跟随重定向，手动处理以确保重定向目标也通过安全检查
      redirect: "manual",
    });

    // 处理重定向：手动跟随，并用 isPermittedRedirect 限制跨主机/降级
    if (resp.status >= 300 && resp.status < 400) {
      if (redirectCount >= MAX_REDIRECTS) {
        return {
          url,
          status: resp.status,
          contentType: null,
          size: 0,
          content: "",
          error: `重定向次数超过限制（${MAX_REDIRECTS} 次）`,
        };
      }

      const location = resp.headers.get("location");
      if (!location) {
        return {
          url,
          status: resp.status,
          contentType: null,
          size: 0,
          content: "",
          error: `重定向响应缺少 Location 头 (HTTP ${resp.status})`,
        };
      }

      // 解析重定向 URL（支持相对路径）
      // 必须使用 upgradedUrl 作为 base，否则 HTTP→HTTPS 升级后的相对重定向
      // 会解析为 http:// 而非 https://，导致 isPermittedRedirect 误判协议不一致
      let redirectUrl: string;
      try {
        redirectUrl = new URL(location, upgradedUrl).toString();
      } catch {
        return {
          url,
          status: resp.status,
          contentType: null,
          size: 0,
          content: "",
          error: `无效的重定向 URL: ${location}`,
        };
      }

      // 安全检查：协议/端口/主机（www 可增减）；凭证允许（相对 Location 会继承 base userinfo）
      if (!isPermittedRedirect(upgradedUrl, redirectUrl)) {
        log.info(`不安全重定向，返回信息让调用方决定: ${redactUrl(upgradedUrl)} -> ${redactUrl(redirectUrl)}`);
        return {
          url: upgradedUrl,
          status: resp.status,
          contentType: null,
          size: 0,
          content: "",
          error: `不安全重定向: ${redactUrl(upgradedUrl)} -> ${redactUrl(redirectUrl)}（状态码 ${resp.status}）。原因：协议/端口/主机名不一致。如需跟随，请直接请求目标 URL。`,
        };
      }

      log.info(`同域重定向: ${redactUrl(upgradedUrl)} -> ${redactUrl(redirectUrl)}`);

      // 递归跟随重定向，重定向计数 +1
      return fetchPageInternal(redirectUrl, options, redirectCount + 1);
    }

    // 检查 HTTP 错误状态
    if (!resp.ok) {
      // 消耗响应体防止连接泄漏
      await resp.text().catch(() => "");
      return {
        url: resp.url || upgradedUrl,
        status: resp.status,
        contentType: resp.headers.get("content-type"),
        size: 0,
        content: "",
        error: `HTTP 错误: ${resp.status} ${resp.statusText}`,
      };
    }

    // 响应体大小防护（两层）：Content-Length 预检 + 流式限流读
    // 优先于二进制检测——Content-Length 是纯 header 检查，比 body 读取更便宜
    const contentTypeHeader = resp.headers.get("content-type");
    const contentLength = Number(resp.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > maxSize) {
      log.warn(`Content-Length 超限: ${contentLength} 字节（限制 ${maxSize} 字节）`);
      await resp.body?.cancel().catch(() => "");
      return {
        url: resp.url || upgradedUrl,
        status: resp.status,
        contentType: contentTypeHeader,
        size: contentLength,
        content: "",
        error: `响应体过大: ${(contentLength / 1024 / 1024).toFixed(1)}MB（限制 ${(maxSize / 1024 / 1024).toFixed(1)}MB）`,
      };
    }

    // 二进制内容检测（借鉴 Claude Code 设计）
    // PDF/图片/视频等二进制内容无法当文本处理，返回友好提示而非乱码
    if (isBinaryContentType(contentTypeHeader)) {
      await resp.body?.cancel().catch(() => "");
      return {
        url: resp.url || upgradedUrl,
        status: resp.status,
        contentType: contentTypeHeader,
        size: contentLength,
        content: "",
        error: `不支持的内容类型: ${contentTypeHeader}（二进制内容无法作为文本处理）`,
      };
    }

    // 流式限流读：按块累积，达到 maxSize 即提前终止，避免 OOM
    const arrayBuffer = await streamToLimitedBuffer(resp.body, maxSize, combinedSignal);
    const size = arrayBuffer.byteLength;

    // 检测字符编码并解码内容
    const charset = detectCharset(arrayBuffer, contentTypeHeader);

    let content: string;
    try {
      content = new TextDecoder(charset).decode(arrayBuffer);
    } catch {
      // 编码不支持时回退到 UTF-8，对 GBK 给出更友好的提示
      if (charset.includes("gbk") || charset.includes("gb2312") || charset.includes("gb18030")) {
        if (!hasGbkSupport()) {
          log.warn(
            `编码 "${charset}" 不被当前 Node.js 版本支持（需要 full-icu）。` +
            `建议升级到 Node.js 22+ 或安装 full-icu 包。回退到 UTF-8（可能产生乱码）。`,
          );
        }
      }
      log.warn(`不支持的编码 "${charset}"，回退到 UTF-8`);
      content = new TextDecoder("utf-8").decode(arrayBuffer);
    }

    log.info(`抓取完成: ${redactUrl(resp.url || upgradedUrl)} (${resp.status}, ${size} 字节, 编码: ${charset})`);

    return {
      url: resp.url || upgradedUrl,
      status: resp.status,
      contentType: contentTypeHeader,
      size,
      content,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // AbortError 区分超时和外部取消
    if (error.name === "AbortError") {
      const cause = "cause" in error ? (error as { cause: unknown }).cause : undefined;
      const isTimeout = cause === TIMEOUT_REASON;
      return {
        url,
        status: 0,
        contentType: null,
        size: 0,
        content: "",
        error: isTimeout ? `请求超时（${timeout}ms）` : "请求被取消",
      };
    }

    // DNS 解析失败、连接拒绝等网络错误
    const nodeCode = "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (typeof nodeCode === "string") {
      const code = nodeCode;
      const errorMap: Record<string, string> = {
        ENOTFOUND: "DNS 解析失败: 无法解析主机名",
        ECONNREFUSED: "连接被拒绝: 目标服务器未监听",
        ECONNRESET: "连接被重置: 服务器中断了连接",
        ETIMEDOUT: "连接超时: 服务器无响应",
        // TLS/SSL 错误（不暴露证书细节，防止信息泄漏给 LLM）
        SELF_SIGNED_CERT_IN_CHAIN: "TLS 证书校验失败（页面使用自签名证书）",
        DEPTH_ZERO_SELF_SIGNED_CERT: "TLS 证书校验失败（自签名证书链）",
        UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS 证书校验失败（无法验证叶子证书）",
        CERT_HAS_EXPIRED: "TLS 证书校验失败（证书已过期）",
        ERR_TLS_CERT_ALTNAME_INVALID: "TLS 证书校验失败（证书域名不匹配）",
        EPROTO: "TLS 握手失败（协议错误）",
      };

      // 对 SSL/TLS 错误类做通配匹配，防止遗漏
      const isTlsError =
        code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_") || code.includes("CERT") || code.includes("SSL");

      const message = errorMap[code] ?? (isTlsError ? "TLS 连接失败" : `网络错误（${code}）`);

      // 原始 error.message 仅进日志，不暴露给 LLM
      log.debug(`原始错误信息: ${code}: ${error.message}`);

      return {
        url,
        status: 0,
        contentType: null,
        size: 0,
        content: "",
        error: message,
      };
    }

    // 其他未知错误（不暴露原始 message 给 LLM）
    log.debug(`未知错误: ${error.message}`);
    return {
      url,
      status: 0,
      contentType: null,
      size: 0,
      content: "",
      error: "网络异常（未知错误）",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 抓取网页内容
 * - 自动检测字符编码
 * - 限制响应体大小防止内存溢出
 * - 超时和中止信号支持
 * - 缓存支持
 * - 错误返回结果对象而非抛出异常（编程错误除外）
 */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchPageResult> {
  // 检查缓存
  const cached = globalFetchCache.get(url);
  if (cached) {
    return cached;
  }

  // 检查是否有相同 URL 的进行中请求（去重）
  const inflight = inflightRequests.get(url);
  if (inflight) {
    logger.debug(`复用进行中的请求: ${redactUrl(url)}`);
    return inflight;
  }

  // 执行抓取，注册到 inflight map
  const promise = fetchPageInternal(url, options, 0);
  inflightRequests.set(url, promise);

  try {
    const result = await promise;

    // 成功结果存入缓存（错误不缓存）
    if (!result.error) {
      globalFetchCache.set(url, result);
    }

    return result;
  } finally {
    inflightRequests.delete(url);
  }
}
