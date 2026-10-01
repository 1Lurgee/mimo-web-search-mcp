/**
 * MiMo API 客户端 - 统一的 chat/completions 调用
 *
 * 从 search.ts 和 fetch-tool.ts 中提取的重复 API 调用逻辑。
 * 封装请求构造、响应校验、错误处理、401 归因。
 * 重试策略由调用方决定（search.ts 有重试，fetch-tool.ts 无重试）。
 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { fetchWithTimeout, TIMEOUT_REASON } from "./util.js";
import { emit401, type ToolConsumer } from "./attribution.js";

// ── 模块级单例 ────────────────────────────────────────

const config = loadConfig();
const logger = createLogger(config);

// ── Zod Schemas（响应校验）────────────────────────────

import { z } from "zod";

/** 搜索结果注解（引用来源） */
const AnnotationSchema = z
  .object({
    title: z.string().optional(),
    site_name: z.string().optional(),
    url: z.string().optional(),
    publish_time: z.string().optional(),
  })
  .passthrough();

/** Web Search 使用统计 */
const WebSearchUsageSchema = z
  .object({
    tool_usage: z.number().optional(),
    page_usage: z.number().optional(),
  })
  .passthrough();

/** Token 使用统计 */
const UsageSchema = z
  .object({
    total_tokens: z.number().optional(),
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    web_search_usage: WebSearchUsageSchema.optional(),
  })
  .passthrough();

/** MiMo API 响应消息 */
const MessageSchema = z
  .object({
    content: z.string().optional(),
    annotations: z.array(AnnotationSchema).optional(),
  })
  .passthrough();

/** MiMo API 响应选项 */
const ChoiceSchema = z
  .object({
    message: MessageSchema.optional(),
  })
  .passthrough();

/** MiMo API 响应结构 */
export const MimoResponseSchema = z
  .object({
    choices: z.array(ChoiceSchema).optional(),
    usage: UsageSchema.optional(),
  })
  .passthrough();
export type MimoResponse = z.infer<typeof MimoResponseSchema>;

// ── 类型定义 ──────────────────────────────────────────

/** MiMo API 请求体 */
export interface MimoRequestBody {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  tools?: unknown[];
  max_completion_tokens: number;
  temperature: number;
  top_p: number;
  stream: boolean;
  thinking: { type: "enabled" | "disabled" };
}

/** API 调用选项 */
export interface ChatCompletionOptions {
  /** 额外工具配置（搜索等） */
  tools?: unknown[];
  /** 外部中止信号 */
  signal?: AbortSignal;
  /** 请求 ID（日志追踪） */
  reqId?: string;
  /** 401 归因的调用方标识（默认 "MiMoAPI"） */
  consumer?: ToolConsumer;
  /** 当前重试尝试次数（写入 401 归因 details，便于排查） */
  attempt?: number;
}

/** 成功结果 */
export interface ChatCompletionSuccess {
  success: true;
  /** AI 生成的文本内容 */
  content: string;
  /** 引用来源注解 */
  annotations: Array<{
    title?: string;
    site_name?: string;
    url?: string;
    publish_time?: string;
  }>;
}

/** 失败结果 */
export interface ChatCompletionFailure {
  success: false;
  /** 错误信息 */
  error: string;
  /** 结构化错误码（替代字符串匹配） */
  code: "timeout" | "cancelled" | "http_error" | "invalid_response" | "empty_response";
  /** HTTP 状态码（http_error 时） */
  status?: number;
}

/** 调用结果 */
export type ChatCompletionResult = ChatCompletionSuccess | ChatCompletionFailure;

// ── 公开 API ─────────────────────────────────────────

/**
 * 调用 MiMo chat/completions API
 *
 * 负责：请求构造 → HTTP 调用 → 响应校验 → 错误映射
 * 不负责：重试（由调用方决定）、进度通知（由调用方处理）
 *
 * @param messages - 对话消息数组
 * @param options - 调用选项
 * @returns 结构化结果（success/failure discriminated union）
 */
export async function chatCompletion(
  messages: MimoRequestBody["messages"],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const { tools, signal, reqId, consumer = "MiMoAPI", attempt } = options;
  const log = reqId ? logger.withReqId(reqId) : logger;

  const body: MimoRequestBody = {
    model: config.model,
    messages,
    max_completion_tokens: config.maxCompletionTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stream: false,
    thinking: { type: config.thinking ? "enabled" : "disabled" },
  };

  if (tools) {
    body.tools = tools;
  }

  if (log.isDebugEnabled()) {
    log.debug("MiMo API request body:", JSON.stringify(body, null, 2));
  }

  try {
    log.info("调用 MiMo API...");

    const resp = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      config.requestTimeout,
      signal,
    );

    log.info(`MiMo API 响应状态: ${resp.status}`);

    if (!resp.ok) {
      const errorBody = await resp.text().catch(() => "");
      // 记录 401 认证失败归因事件（与历史行为一致：仅 401，不含 403）
      if (resp.status === 401) {
        emit401(consumer, config.apiKey, {
          status: resp.status,
          ...(attempt !== undefined && { attempt }),
        });
      }
      if (log.isDebugEnabled() && errorBody) {
        log.debug(`MiMo API error body (HTTP ${resp.status}):`, errorBody.substring(0, 500));
      }
      return {
        success: false,
        error: `MiMo API 请求失败 (HTTP ${resp.status})`,
        code: "http_error",
        status: resp.status,
      };
    }

    const rawData: unknown = await resp.json();
    if (log.isDebugEnabled()) {
      log.debug("MiMo API response:", JSON.stringify(rawData, null, 2));
    }

    const parsed = MimoResponseSchema.safeParse(rawData);
    if (!parsed.success) {
      log.error("MiMo API 响应校验失败:", parsed.error.message);
      return { success: false, error: "MiMo API 返回了无效的响应格式", code: "invalid_response" };
    }

    const data = parsed.data;
    const message = data.choices?.[0]?.message;
    if (!message?.content) {
      return { success: false, error: "MiMo API 返回了空响应", code: "empty_response" };
    }

    const annotations = (message.annotations ?? []).map((a) => ({
      title: a.title,
      site_name: a.site_name,
      url: a.url,
      publish_time: a.publish_time,
    }));

    // usage 写入 debug 日志（含 web_search_usage，便于成本观察），不透出给调用方
    if (data.usage && log.isDebugEnabled()) {
      const u = data.usage;
      const searchUsage = u.web_search_usage
        ? ` web_search: tool=${u.web_search_usage.tool_usage ?? "-"} page=${u.web_search_usage.page_usage ?? "-"}`
        : "";
      log.debug(
        `MiMo API usage: total=${u.total_tokens ?? "-"} prompt=${u.prompt_tokens ?? "-"} completion=${u.completion_tokens ?? "-"}${searchUsage}`,
      );
    }

    log.info(`MiMo API 调用完成，内容长度: ${message.content.length}`);
    return {
      success: true,
      content: message.content,
      annotations,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // AbortError（超时/取消）→ 返回 failure result，调用方通过 code 字段判断重试
    if (error.name === "AbortError") {
      const cause = "cause" in error ? (error as { cause: unknown }).cause : undefined;
      const isTimeout = cause === TIMEOUT_REASON;
      return {
        success: false,
        error: isTimeout ? "MiMo API 请求超时" : "请求被取消",
        code: isTimeout ? "timeout" : "cancelled",
      };
    }

    // 网络错误（ECONNRESET、ECONNREFUSED 等）→ 重新抛出原始异常
    // 让调用方根据 error.code 决定是否重试
    throw error;
  }
}
