/**
 * 网页抓取缓存模块（简化版）
 *
 * 本地使用简化：
 * - 统一 TTL，不区分截断/完整内容
 * - 简单 LRU 淘汰
 */

import { createLogger } from "./logger.js";
import type { FetchPageResult } from "./fetch.js";

// ── 模块级单例 ────────────────────────────────────────

import { loadConfig } from "./config.js";
const config = loadConfig();
const logger = createLogger(config);

// ── 类型定义 ──────────────────────────────────────────

/** 缓存条目 */
interface CacheEntry {
  /** 抓取结果 */
  data: FetchPageResult;
  /** 过期时间戳（毫秒） */
  expires: number;
}

// ── 缓存实现 ──────────────────────────────────────────

/**
 * 网页抓取缓存
 * 本地使用：统一 TTL，简单 LRU
 */
export class FetchCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;

  /**
   * @param ttlSeconds - 缓存 TTL（秒），默认 300（5分钟）
   * @param maxEntries - 最大缓存条目数，默认 50
   */
  constructor(ttlSeconds = 300, maxEntries = 50) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  /**
   * 获取缓存的抓取结果
   */
  get(url: string): FetchPageResult | null {
    const entry = this.cache.get(url);
    if (!entry) return null;

    // 检查是否过期
    if (entry.expires < Date.now()) {
      this.cache.delete(url);
      return null;
    }

    logger.debug(`缓存命中: ${url}`);
    return entry.data;
  }

  /**
   * 存入缓存
   */
  set(url: string, data: FetchPageResult): void {
    // LRU 淘汰：达到上限时移除最旧的条目
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(url, {
      data,
      expires: Date.now() + this.ttlMs,
    });

    logger.debug(`缓存写入: ${url}`);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    if (size > 0) {
      logger.info(`缓存已清除 (${size} 条)`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  stats(): { size: number; maxEntries: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
    };
  }
}

// ── 全局单例 ──────────────────────────────────────────

/** 全局缓存实例 */
export const globalFetchCache = new FetchCache();
