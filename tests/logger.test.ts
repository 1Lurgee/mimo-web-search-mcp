import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";
import { LogLevel, type AppConfig } from "../src/config.js";

function makeConfig(level: LogLevel): AppConfig {
  return {
    apiKey: "test",
    baseUrl: "https://test.com",
    model: "mimo-v2.5-pro",
    requestTimeout: 60000,
    maxCompletionTokens: 5120,
    temperature: 0.4,
    topP: 0.95,
    thinking: false,
    logLevel: level,
    maxRetries: 2,
    retryDelay: 1000,
    maxContentLength: 100000,
    maxConcurrent: 10,
    defaultMaxKeyword: 3,
    defaultLimit: 5,
    maxQueryLength: 10000,
  };
}

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  // ── 日志级别过滤 ─────────────────────────────────

  it("ERROR 级别下，error 输出，warn/info/debug 不输出", () => {
    const logger = createLogger(makeConfig(LogLevel.ERROR));

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("dbg");

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search]", "err");
  });

  it("WARN 级别下，error 和 warn 输出，info/debug 不输出", () => {
    const logger = createLogger(makeConfig(LogLevel.WARN));

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("dbg");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search]", "err");
    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search]", "warn");
  });

  it("INFO 级别下，error/warn/info 输出，debug 不输出", () => {
    const logger = createLogger(makeConfig(LogLevel.INFO));

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("dbg");

    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it("DEBUG 级别下，所有级别都输出", () => {
    const logger = createLogger(makeConfig(LogLevel.DEBUG));

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("dbg");

    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });

  // ── 前缀和参数传递 ───────────────────────────────

  it("所有日志都带 [mimo-web-search] 前缀", () => {
    const logger = createLogger(makeConfig(LogLevel.DEBUG));

    logger.info("test message");

    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search]", "test message");
  });

  it("支持多个参数", () => {
    const logger = createLogger(makeConfig(LogLevel.DEBUG));
    const obj = { key: "value" };

    logger.debug("data:", obj, 123);

    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search]", "data:", obj, 123);
  });

  it("ERROR 始终输出，即使 logLevel 低于 ERROR", () => {
    // ERROR = 0，这是最低级别，但代码中 ERROR 始终输出
    const logger = createLogger(makeConfig(LogLevel.ERROR));
    logger.error("critical");
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  // ── 请求级子日志器 ─────────────────────────────────

  it("withReqId 子日志器带请求 ID 前缀", () => {
    const logger = createLogger(makeConfig(LogLevel.DEBUG));
    const reqLogger = logger.withReqId("abc12345");

    reqLogger.info("test");

    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search] [req:abc12345]", "test");
  });

  it("withReqId 子日志器继承日志级别过滤", () => {
    const logger = createLogger(makeConfig(LogLevel.ERROR));
    const reqLogger = logger.withReqId("abc12345");

    reqLogger.info("should not appear");
    reqLogger.error("should appear");

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search] [req:abc12345]", "should appear");
  });

  it("withReqId 子日志器的 isDebugEnabled 继承父级", () => {
    const logger = createLogger(makeConfig(LogLevel.DEBUG));
    const reqLogger = logger.withReqId("abc12345");

    expect(reqLogger.isDebugEnabled()).toBe(true);
  });

  it("withReqId 可链式调用（前缀叠加）", () => {
    const logger = createLogger(makeConfig(LogLevel.DEBUG));
    const reqLogger = logger.withReqId("first").withReqId("second");

    reqLogger.info("msg");

    expect(stderrSpy).toHaveBeenCalledWith("[mimo-web-search] [req:first] [req:second]", "msg");
  });
});
