/**
 * 字符编码检测模块
 *
 * 从 fetch.ts 提取的纯函数，零副作用，可独立测试。
 * 检测优先级：BOM → Content-Type header → HTML meta 标签 → 默认 UTF-8
 */

// ── GBK 支持探测 ──────────────────────────────────────

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
 * 获取当前 Node ICU 是否支持 GBK 编码
 * 用于在解码失败时给出友好提示
 */
export function hasGbkSupport(): boolean {
  return _hasGbk;
}

// ── BOM 嗅探 ─────────────────────────────────────────

/**
 * 从二进制数据开头嗅探 BOM（Byte Order Mark）
 * BOM 优先级最高，因为它直接来自文件内容，比 header/meta 更可靠
 */
function detectBom(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  // UTF-8 BOM: EF BB BF
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  // UTF-32 LE BOM: FF FE 00 00（必须在 UTF-16 LE 之前检查，因为前缀相同）
  if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) return "utf-32le";
  // UTF-32 BE BOM: 00 00 FE FF（必须在 UTF-16 BE 之前检查，因为后缀相同）
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) return "utf-32be";
  // UTF-16 LE BOM: FF FE
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  // UTF-16 BE BOM: FE FF
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

// ── HTML meta 标签检测 ────────────────────────────────

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

// ── 主检测函数 ────────────────────────────────────────

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
