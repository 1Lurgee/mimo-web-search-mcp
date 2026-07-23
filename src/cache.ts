/**
 * 网页抓取缓存模块
 *
 * 使用 lru-cache 实现大小感知的 LRU 缓存（借鉴 Claude Code 设计）
 * - 按内容字节大小淘汰，而非简单条目计数
 * - 一个大页面（几MB）不会轻易挤掉多个小页面
 */

import { LRUCache } from "lru-cache";
import { createLogger } from "./logger.js";
import type { FetchPageResult } from "./fetch.js";

// ── 模块级单例 ────────────────────────────────────────

import { loadConfig } from "./config.js";
const config = loadConfig();
const logger = createLogger(config);

// ── 缓存常量 ──────────────────────────────────────────

/** 缓存 TTL：5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 缓存总大小上限：50MB */
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;

// ── 缓存实现 ──────────────────────────────────────────

/**
 * 全局缓存实例（大小感知 LRU）
 *
 * 与 Claude Code 的 WebFetchTool 使用相同的 lru-cache 库和相似配置。
 * 区别：本地工具不需要 15 分钟 TTL（5 分钟足够），也不需要域名级别的缓存键。
 */
const cache = new LRUCache<string, FetchPageResult>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
  // 按实际内存占用计算条目权重（JS 字符串为 UTF-16，每字符 2 字节）
  // 空内容至少占 1 字节（lru-cache 要求正整数）
  sizeCalculation: (value) => Math.max(1, value.content.length * 2),
});

// ── 公开 API ────────────────────────────────────────

export const globalFetchCache = {
  get(url: string): FetchPageResult | null {
    const entry = cache.get(url);
    if (entry) {
      logger.debug(`缓存命中: ${url}`);
    }
    return entry ?? null;
  },

  set(url: string, data: FetchPageResult): void {
    cache.set(url, data);
    logger.debug(`缓存写入: ${url} (${data.size} 字节)`);
  },

};
