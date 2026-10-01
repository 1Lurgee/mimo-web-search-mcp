/**
 * 请求侧类型定义
 *
 * API 响应的 Zod Schema 和类型位于 ./mimo-client.ts。
 * 此处只放无需运行时校验的请求参数 interface，
 * 不 re-export mimo-client 的值（会触发其模块初始化并要求 MIMO_API_KEY）。
 */

// ── 请求侧类型（无需运行时校验，保留 interface）────────

/** Web Search 工具配置 */
export interface WebSearchToolConfig {
  type: "web_search";
  max_keyword: number;
  limit: number;
  force_search: boolean;
  user_location?: UserLocation;
}

/** 用户位置信息 */
export interface UserLocation {
  type: "approximate";
  country?: string;
  region?: string;
  city?: string;
}

/** 搜索参数 */
export interface SearchParams {
  query: string;
  max_keyword: number;
  limit: number;
  force_search: boolean;
  country?: string;
  region?: string;
  city?: string;
  /** 域名白名单：仅搜索指定域名的结果（借鉴 grok-build 设计） */
  allowed_domains?: string[];
}

/** 网页抓取参数 */
export interface FetchParams {
  url: string;
  prompt?: string;
  clean: boolean;
  maxLength: number;
}
