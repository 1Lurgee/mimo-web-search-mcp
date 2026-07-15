/** MiMo API 响应类型定义 */

import { z } from "zod";

// ── Zod Schemas（运行时校验 + 类型推导）───────────────────

/** 搜索结果注解（引用来源） */
export const AnnotationSchema = z
  .object({
    title: z.string().optional(),
    site_name: z.string().optional(),
    url: z.string().optional(),
    publish_time: z.string().optional(),
  })
  .passthrough();
export type Annotation = z.infer<typeof AnnotationSchema>;

/** Web Search 使用统计 */
export const WebSearchUsageSchema = z
  .object({
    tool_usage: z.number().optional(),
    page_usage: z.number().optional(),
  })
  .passthrough();

/** Token 使用统计 */
export const UsageSchema = z
  .object({
    total_tokens: z.number().optional(),
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    web_search_usage: WebSearchUsageSchema.optional(),
  })
  .passthrough();
export type Usage = z.infer<typeof UsageSchema>;

/** MiMo API 响应消息 */
export const MessageSchema = z
  .object({
    content: z.string().optional(),
    annotations: z.array(AnnotationSchema).optional(),
  })
  .passthrough();
export type Message = z.infer<typeof MessageSchema>;

/** MiMo API 响应选项 */
export const ChoiceSchema = z
  .object({
    message: MessageSchema.optional(),
  })
  .passthrough();
export type Choice = z.infer<typeof ChoiceSchema>;

/** MiMo API 响应结构 */
export const MimoResponseSchema = z
  .object({
    choices: z.array(ChoiceSchema).optional(),
    usage: UsageSchema.optional(),
  })
  .passthrough();
export type MimoResponse = z.infer<typeof MimoResponseSchema>;

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
