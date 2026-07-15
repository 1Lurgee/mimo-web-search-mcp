/** 应用配置管理 */

/** 日志级别枚举 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/** 配置接口 */
export interface AppConfig {
  /** MiMo API 密钥 */
  apiKey: string;
  /** API 基础 URL */
  baseUrl: string;
  /** 模型名称 */
  model: string;
  /** 请求超时时间（毫秒） */
  requestTimeout: number;
  /** 最大生成 token 数 */
  maxCompletionTokens: number;
  /** 采样温度 */
  temperature: number;
  /** 核采样概率 */
  topP: number;
  /** 启用流式响应 */
  stream: boolean;
  /** 启用思考模式 */
  thinking: boolean;
  /** 日志级别 */
  logLevel: LogLevel;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
  /** 最大内容长度 */
  maxContentLength: number;
  /** 最大并发请求数 */
  maxConcurrent: number;
  /** 默认最大关键词数 */
  defaultMaxKeyword: number;
  /** 默认返回结果数 */
  defaultLimit: number;
  /** 查询最大字符数 */
  maxQueryLength: number;
}

/** 解析环境变量为整数，失败返回默认值 */
function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** 解析环境变量为浮点数，失败返回默认值 */
function parseFloatEnv(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** 解析环境变量为布尔值，失败返回默认值 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value === "true" || value === "1";
}

/** 验证 URL 格式 */
function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** 加载并验证配置 */
export function loadConfig(): AppConfig {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    throw new Error("MIMO_API_KEY environment variable is required.");
  }

  const baseUrl = (process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1").replace(/\/+$/, "");
  if (!validateUrl(baseUrl)) {
    throw new Error(`Invalid MIMO_BASE_URL format: ${baseUrl}`);
  }

  const debugValue = process.env.DEBUG;
  let logLevel: LogLevel;
  if (debugValue && /^\d+$/.test(debugValue)) {
    // 纯数字：0=ERROR, 1=INFO, 2+=DEBUG
    const level = parseInt(debugValue, 10);
    logLevel = level >= 2 ? LogLevel.DEBUG : level >= 1 ? LogLevel.INFO : LogLevel.ERROR;
  } else if (debugValue && /mimo/i.test(debugValue)) {
    // 命名空间模式：DEBUG=mimo*、DEBUG=mimo-web-search 等
    logLevel = LogLevel.DEBUG;
  } else {
    logLevel = LogLevel.ERROR;
  }

  return {
    apiKey,
    baseUrl,
    model: process.env.MIMO_MODEL || "mimo-v2.5-pro",
    requestTimeout: parseIntEnv(process.env.REQUEST_TIMEOUT, 60000),
    maxCompletionTokens: parseIntEnv(process.env.MAX_COMPLETION_TOKENS, 5120),
    temperature: parseFloatEnv(process.env.TEMPERATURE, 0.4),
    topP: parseFloatEnv(process.env.TOP_P, 0.95),
    stream: parseBoolEnv(process.env.MIMO_STREAM, false),
    thinking: parseBoolEnv(process.env.MIMO_THINKING, false),
    logLevel,
    maxRetries: parseIntEnv(process.env.MAX_RETRIES, 2),
    retryDelay: parseIntEnv(process.env.RETRY_DELAY, 1000),
    maxContentLength: parseIntEnv(process.env.MAX_CONTENT_LENGTH, 100000),
    maxConcurrent: parseIntEnv(process.env.MAX_CONCURRENT, 10),
    defaultMaxKeyword: parseIntEnv(process.env.DEFAULT_MAX_KEYWORD, 3),
    defaultLimit: parseIntEnv(process.env.DEFAULT_LIMIT, 5),
    maxQueryLength: parseIntEnv(process.env.MAX_QUERY_LENGTH, 10000),
  };
}
