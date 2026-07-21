/** 网页抓取模块 - HTTP fetch 用于获取网页内容 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { validateUrl, resolveAndCheckHost } from "./ssrf.js";
import { mergeAbortSignals } from "./util.js";
import { globalFetchCache } from "./cache.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

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

// ── SSRF 防护（核心逻辑已抽至 ./ssrf.ts）──────────────

// ── 编码检测 ──────────────────────────────────────────

/**
 * 模块装载时探测 Node ICU 是否支持 GBK 编码
 * Node 20 默认 small-icu 可能不含 GBK；Node 22+ 通常包含 full-icu
 * 此标志用于在解码失败时给出更友好的提示
 */
let _hasGbk = true;
try {
  new TextDecoder("gbk");
} catch {
  _hasGbk = false;
}

/**
 * 从二进制数据开头嗅探 BOM（Byte Order Mark）
 * BOM 优先级最高，因为它直接来自文件内容，比 header/meta 更可靠
 */
function detectBom(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  // UTF-8 BOM: EF BB BF
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  // UTF-16 LE BOM: FF FE
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  // UTF-16 BE BOM: FE FF
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // UTF-32 LE BOM: FF FE 00 00
  if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) return "utf-32le";
  // UTF-32 BE BOM: 00 00 FE FF
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) return "utf-32be";
  return null;
}

/**
 * 从 HTML 内容中检测字符编码
 * 按优先级依次检查：
 * 1. <meta charset="...">
 * 2. <meta http-equiv="Content-Type" content="...; charset=...">
 * 仅检查前 1024 字节以提高性能
 */
function detectCharsetFromHtml(buffer: ArrayBuffer): string | null {
  // 取前 1024 字节用 ASCII 兼容编码解码，足以覆盖 <head> 中的 meta 标签
  const head = new TextDecoder("ascii").decode(buffer.slice(0, 1024));

  // 匹配 <meta charset="utf-8"> 或 <meta charset='utf-8'>
  const charsetMatch = head.match(/<meta[^>]+charset=["']?\s*([a-zA-Z0-9_-]+)/i);
  if (charsetMatch) {
    return charsetMatch[1].trim().toLowerCase();
  }

  // 匹配 <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  const httpEquivMatch = head.match(
    /<meta[^>]+http-equiv=["']Content-Type["'][^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i,
  );
  if (httpEquivMatch) {
    return httpEquivMatch[1].trim().toLowerCase();
  }

  return null;
}

/**
 * 检测响应内容的字符编码
 * 按优先级：BOM -> Content-Type header -> HTML meta 标签 -> 默认 UTF-8
 */
export function detectCharset(buffer: ArrayBuffer, contentTypeHeader: string | null): string {
  // 1. BOM 嗅探（最高优先级，直接来自文件内容）
  const bomCharset = detectBom(buffer);
  if (bomCharset) {
    return bomCharset;
  }

  // 2. 从 Content-Type 头解析 charset
  if (contentTypeHeader) {
    const charsetMatch = contentTypeHeader.match(/charset=([a-zA-Z0-9_-]+)/i);
    if (charsetMatch) {
      return charsetMatch[1].trim().toLowerCase();
    }
  }

  // 3. 从 HTML meta 标签检测
  const htmlCharset = detectCharsetFromHtml(buffer);
  if (htmlCharset) {
    return htmlCharset;
  }

  // 4. 默认 UTF-8
  return "utf-8";
}

/**
 * 获取当前 Node ICU 是否支持 GBK 编码
 * 用于在解码失败时给出友好提示
 */
export function hasGbkSupport(): boolean {
  return _hasGbk;
}

// ── HTTP 请求（mergeAbortSignals 已迁移至 ./util.ts）──

/** 最大重定向次数，防止无限重定向循环 */
const MAX_REDIRECTS = 5;

/**
 * 流式读取响应体，限制最大字节数以防止 OOM
 * 当累计达到 maxSize 即提前终止，返回截断后的内容
 */
async function streamToLimitedBuffer(
  body: ReadableStream<Uint8Array> | null,
  maxSize: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!body) return new ArrayBuffer(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done || !value) break;

      const remaining = maxSize - totalSize;
      if (remaining <= 0) {
        // 已达上限，丢弃剩余数据
        break;
      }

      if (value.byteLength <= remaining) {
        chunks.push(value);
        totalSize += value.byteLength;
      } else {
        // 只截取到 maxSize 的部分
        chunks.push(value.slice(0, remaining));
        totalSize += remaining;
        break;
      }
    }
  } finally {
    // 确保 reader 释放（取消底层流）
    await reader.cancel().catch(() => "");
  }

  // 合并 chunks 为单个 ArrayBuffer
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

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

  // URL 安全验证（含端口 allowlist）
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

  // DNS rebinding 防护：解析域名并复核所有解析 IP 是否为内网
  const dnsError = await resolveAndCheckHost(url);
  if (dnsError) {
    return {
      url,
      status: 0,
      contentType: null,
      size: 0,
      content: "",
      error: dnsError,
    };
  }

  // 超时控制：创建内部 AbortController，与外部信号合并
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("fetch_timeout"), timeout);

  const combinedSignal = signal
    ? mergeAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    log.info(`抓取网页: ${url}`);

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        // 模拟浏览器 User-Agent，避免被网站拒绝
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: combinedSignal,
      // 不自动跟随重定向，手动处理以确保重定向目标也通过 SSRF 检查
      redirect: "manual",
    });

    // 处理重定向：手动跟随以对每个重定向目标做 SSRF 检查
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
      let redirectUrl: string;
      try {
        redirectUrl = new URL(location, url).toString();
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

      log.info(`重定向: ${url} -> ${redirectUrl}`);

      // 递归跟随重定向，重定向计数 +1
      return fetchPageInternal(redirectUrl, options, redirectCount + 1);
    }

    // 检查 HTTP 错误状态
    if (!resp.ok) {
      // 消耗响应体防止连接泄漏
      await resp.text().catch(() => "");
      return {
        url: resp.url || url,
        status: resp.status,
        contentType: resp.headers.get("content-type"),
        size: 0,
        content: "",
        error: `HTTP 错误: ${resp.status} ${resp.statusText}`,
      };
    }

    // 响应体大小防护（两层）：Content-Length 预检 + 流式限流读
    const contentLength = Number(resp.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > maxSize) {
      log.warn(`Content-Length 超限: ${contentLength} 字节（限制 ${maxSize} 字节）`);
      await resp.body?.cancel().catch(() => "");
      return {
        url: resp.url || url,
        status: resp.status,
        contentType: resp.headers.get("content-type"),
        size: contentLength,
        content: "",
        error: `响应体过大: ${(contentLength / 1024 / 1024).toFixed(1)}MB（限制 ${(maxSize / 1024 / 1024).toFixed(1)}MB）`,
      };
    }

    // 流式限流读：按块累积，达到 maxSize+1 即提前终止，避免 OOM
    const arrayBuffer = await streamToLimitedBuffer(resp.body, maxSize, combinedSignal);
    const size = arrayBuffer.byteLength;

    if (size > maxSize) {
      log.warn(`流式读取超限: ${size} 字节（限制 ${maxSize} 字节）`);
      return {
        url: resp.url || url,
        status: resp.status,
        contentType: resp.headers.get("content-type"),
        size,
        content: "",
        error: `响应体过大: ${(size / 1024 / 1024).toFixed(1)}MB（限制 ${(maxSize / 1024 / 1024).toFixed(1)}MB）`,
      };
    }

    // 检测字符编码并解码内容
    const contentTypeHeader = resp.headers.get("content-type");
    const charset = detectCharset(arrayBuffer, contentTypeHeader);

    let content: string;
    try {
      content = new TextDecoder(charset).decode(arrayBuffer);
    } catch {
      // 编码不支持时回退到 UTF-8，对 GBK 给出更友好的提示
      if (charset.includes("gbk") || charset.includes("gb2312") || charset.includes("gb18030")) {
        if (!_hasGbk) {
          log.warn(
            `编码 "${charset}" 不被当前 Node.js 版本支持（需要 full-icu）。` +
            `建议升级到 Node.js 22+ 或安装 full-icu 包。回退到 UTF-8（可能产生乱码）。`,
          );
        }
      }
      log.warn(`不支持的编码 "${charset}"，回退到 UTF-8`);
      content = new TextDecoder("utf-8").decode(arrayBuffer);
    }

    log.info(`抓取完成: ${resp.url || url} (${resp.status}, ${size} 字节, 编码: ${charset})`);

    return {
      url: resp.url || url,
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
      const isTimeout = cause === "fetch_timeout";
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

  // 执行抓取
  const result = await fetchPageInternal(url, options, 0);

  // 成功结果存入缓存（错误不缓存）
  if (!result.error) {
    globalFetchCache.set(url, result);
  }

  return result;
}
