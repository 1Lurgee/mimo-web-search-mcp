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
  /** 请求超时时间（毫秒） */
  requestTimeout: number;
  /** 最大生成 token 数 */
  maxCompletionTokens: number;
  /** 采样温度 */
  temperature: number;
  /** 核采样概率 */
  topP: number;
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

  const debugLevel = parseIntEnv(process.env.DEBUG, 0);
  let logLevel: LogLevel;
  if (debugLevel >= 2) {
    logLevel = LogLevel.DEBUG;
  } else if (debugLevel >= 1) {
    logLevel = LogLevel.INFO;
  } else {
    logLevel = LogLevel.ERROR;
  }

  return {
    apiKey,
    baseUrl,
    requestTimeout: parseIntEnv(process.env.REQUEST_TIMEOUT, 60000),
    maxCompletionTokens: parseIntEnv(process.env.MAX_COMPLETION_TOKENS, 2048),
    temperature: parseFloatEnv(process.env.TEMPERATURE, 0.2),
    topP: parseFloatEnv(process.env.TOP_P, 0.95),
    logLevel,
    maxRetries: 2,
    retryDelay: 1000,
    maxContentLength: 100000,
    maxConcurrent: 10,
  };
}
