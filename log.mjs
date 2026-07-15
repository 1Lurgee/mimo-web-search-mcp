// 日志工具 - 通过 DEBUG 环境变量控制日志级别
// DEBUG=0 (默认): 仅错误和警告
// DEBUG=1: 信息级别（请求/响应摘要）
// DEBUG=2: 详细调试（含完整请求体）

const LEVEL = { error: 0, warn: 1, info: 2, debug: 3 };
const DEBUG = parseInt(process.env.DEBUG) || 0;
const PREFIX = "[mimo-web-search]";

function log(level, ...args) {
  if (LEVEL[level] <= DEBUG + 1 || level === "error") {
    // error 始终输出；info 需要 DEBUG>=1；debug 需要 DEBUG>=2
    console.error(PREFIX, ...args);
  }
}

export const logger = {
  error: (...args) => log("error", ...args),
  warn: (...args) => log("warn", ...args),
  info: (...args) => log("info", ...args),
  debug: (...args) => log("debug", ...args),
};
