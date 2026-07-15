/** MiMo API 响应类型定义 */

/** 搜索结果注解（引用来源） */
export interface Annotation {
  title?: string;
  site_name?: string;
  url?: string;
  publish_time?: string;
}

/** Web Search 使用统计 */
export interface WebSearchUsage {
  tool_usage?: number;
  page_usage?: number;
}

/** Token 使用统计 */
export interface Usage {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  web_search_usage?: WebSearchUsage;
}

/** MiMo API 响应消息 */
export interface Message {
  content?: string;
  annotations?: Annotation[];
}

/** MiMo API 响应选项 */
export interface Choice {
  message?: Message;
}

/** MiMo API 响应结构 */
export interface MimoResponse {
  choices?: Choice[];
  usage?: Usage;
}

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

/** MiMo API 请求体 */
export interface MimoRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools: WebSearchToolConfig[];
  max_completion_tokens: number;
  temperature: number;
  top_p: number;
  stream: boolean;
  thinking: { type: string };
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
}
