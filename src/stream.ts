/**
 * 流式响应体读取与二进制内容检测模块
 *
 * 从 fetch.ts 提取的纯函数/低副作用函数，可独立测试。
 * - streamToLimitedBuffer: 流式读取响应体，限制最大字节数防止 OOM
 * - isBinaryContentType: 白名单策略判断是否为二进制内容类型
 */

// ── AbortError 工具 ───────────────────────────────────

/**
 * 将 abort 规范为 AbortError，并尽量保留 signal.reason（如 TIMEOUT_REASON）。
 * Node/undici 在 signal abort 时，fetch 拒绝的 AbortError.cause 往往就是 reason。
 */
function abortErrorFromSignal(signal?: AbortSignal): DOMException {
  const err = new DOMException("The operation was aborted.", "AbortError");
  const reason = signal?.reason;
  if (reason !== undefined) {
    Object.defineProperty(err, "cause", { value: reason, configurable: true });
  }
  return err;
}

// ── 二进制内容检测 ────────────────────────────────────

/**
 * 检测是否为二进制内容类型（对齐 Claude Code 白名单策略）
 *
 * 采用白名单而非黑名单：默认认为所有类型都是二进制的，只排除已知的文本类型。
 * 黑名单策略的问题：永远无法穷举所有二进制类型（application/wasm、font/woff 等），
 * 未知类型会被当文本解码产生乱码并浪费 token。
 *
 * 先用 split(';')[0] 剥离 charset 等参数，只比较主 MIME 类型。
 */
export function isBinaryContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mt = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (mt.startsWith("text/")) return false;
  if (mt.endsWith("+json") || mt === "application/json") return false;
  if (mt.endsWith("+xml") || mt === "application/xml") return false;
  if (mt.startsWith("application/javascript")) return false;
  if (mt === "application/x-www-form-urlencoded") return false;
  return true;
}

// ── 流式限流读 ────────────────────────────────────────

/**
 * 流式读取响应体，限制最大字节数以防止 OOM。
 * 当累计达到 maxSize 即提前终止，返回截断后的内容。
 * signal 中止时必须抛出 AbortError（不可静默返回半截数据，否则会被缓存）。
 */
export async function streamToLimitedBuffer(
  body: ReadableStream<Uint8Array> | null,
  maxSize: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!body) return new ArrayBuffer(0);
  if (signal?.aborted) throw abortErrorFromSignal(signal);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      // 中止必须抛错：静默 break 会被上层当成成功 200 并写入缓存
      if (signal?.aborted) throw abortErrorFromSignal(signal);

      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (readErr) {
        // 底层流因 abort/cancel 失败时，优先表现为 AbortError
        if (signal?.aborted) throw abortErrorFromSignal(signal);
        throw readErr;
      }

      // read() 等待期间可能已 abort；即便 done=true 也不能当成功半截内容
      if (signal?.aborted) throw abortErrorFromSignal(signal);

      if (done || !value) break;

      const remaining = maxSize - totalSize;
      if (remaining <= 0) {
        // 已达上限，丢弃剩余数据（截断成功，非错误）
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
