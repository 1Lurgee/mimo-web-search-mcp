/** SPA 浏览器渲染降级模块 - 当网页为 SPA 且启用浏览器时，用 Playwright 渲染 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { redactUrl } from "./ssrf.js";

const config = loadConfig();
const logger = createLogger(config);

// ── SPA 启发式检测 ────────────────────────────────────

/** SPA 典型标记模式 */
const SPA_MARKERS = [
  /<div\s+id=["']root["']/i,
  /<div\s+id=["']app["']/i,
  /<div\s+id=["']__next["']/i,
  /<script[^>]*>[\s\S]*?__NEXT_DATA__/i,
  /<script[^>]*>[\s\S]*?window\.__INITIAL_STATE__/i,
  /<script[^>]*>[\s\S]*?__NUXT__/i,
  /<noscript[^>]*>[\s\S]*?JavaScript is required/i,
];

/**
 * 快速预检：用 indexOf 检查关键字符串，全部不命中则跳过正则匹配
 * 避免 7 个正则逐一扫描 10MB+ 大页面导致秒级延迟
 */
const SPA_QUICK_CHECKS = [
  'id="root"', "id='root'",
  'id="app"', "id='app'",
  'id="__next"', "id='__next'",
  "__NEXT_DATA__",
  "__INITIAL_STATE__",
  "__NUXT__",
  "JavaScript is required",
];

/**
 * 检测 HTML 是否疑似 SPA（单页应用）
 * 启发式规则：
 * 1. clean 转换后的 markdown 内容过短（< 200 字符）
 * 2. 原始 HTML 包含 SPA 典型标记（div#root、__NEXT_DATA__ 等）
 */
export function isSpaPage(html: string, markdownLength: number): boolean {
  // markdown 内容足够长，不是 SPA
  if (markdownLength >= 200) return false;

  // 快速预检：indexOf 比正则快 1-2 个数量级
  if (!SPA_QUICK_CHECKS.some((s) => html.includes(s))) return false;

  // 精确匹配：确认是真正的 SPA 标记（排除注释、字符串中的误命中）
  return SPA_MARKERS.some((pattern) => pattern.test(html));
}

// ── Playwright 浏览器渲染 ─────────────────────────────

// 浏览器实例缓存（复用避免每次启动 Chromium 的开销 ~100-200MB）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browserInstance: any = null;
let _browserIdleTimer: ReturnType<typeof setTimeout> | null = null;
let _browserClosing = false; // 防止在 close() 进行中时复用浏览器
const BROWSER_IDLE_TIMEOUT_MS = 30_000; // 空闲 30 秒自动关闭

function scheduleBrowserClose(): void {
  if (_browserIdleTimer) clearTimeout(_browserIdleTimer);
  _browserIdleTimer = setTimeout(async () => {
    if (_browserInstance) {
      _browserClosing = true;
      logger.info("浏览器实例空闲超时，自动关闭");
      await _browserInstance.close().catch(() => "");
      _browserInstance = null;
      _browserClosing = false;
    }
  }, BROWSER_IDLE_TIMEOUT_MS);
  // 不阻塞进程退出
  if (_browserIdleTimer.unref) _browserIdleTimer.unref();
}

/** 浏览器渲染结果 */
export interface RenderResult {
  /** 渲染后的 HTML 内容 */
  html: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 使用 Playwright 渲染 SPA 页面
 * 动态 import playwright，未安装时返回友好提示
 *
 * @param url - 目标 URL
 * @param timeout - 渲染超时（毫秒）
 * @returns 渲染结果
 */
export async function renderWithBrowser(url: string, timeout: number = config.fetchTimeout): Promise<RenderResult> {
  // 动态导入 playwright——避免硬依赖，未安装时给出友好提示
  // 使用变量拼接避免 TypeScript 静态解析模块路径
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;
  try {
    const modName = "playwright";
    playwright = await import(modName);
  } catch {
    return {
      html: "",
      success: false,
      error: "浏览器渲染需要 playwright。请先运行: npm install playwright && npx playwright install chromium",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  try {
    // 复用缓存的浏览器实例（避免每次启动 Chromium 的开销）
    if (!_browserClosing && _browserInstance?.isConnected()) {
      browser = _browserInstance;
      logger.debug(`复用浏览器实例: ${redactUrl(url)}`);
    } else {
      logger.info(`启动浏览器渲染: ${redactUrl(url)}`);
      browser = await playwright.chromium.launch({ headless: true });
      _browserInstance = browser;
    }

    const page = await browser.newPage();
    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout,
      });

      // 等待页面稳定（SPA 路由和数据加载完成后）
      await page.waitForTimeout(1000);

      const html = await page.content();
      logger.info(`浏览器渲染完成: ${redactUrl(url)} (${html.length} 字符)`);

      return { html, success: true };
    } finally {
      await page.close().catch(() => "");
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(`浏览器渲染失败: ${error.message}`);

    // 连接断开时清理缓存实例
    if (browser && !browser.isConnected()) {
      _browserInstance = null;
    }

    return {
      html: "",
      success: false,
      error: `浏览器渲染失败: ${error.message}`,
    };
  } finally {
    // 不关闭浏览器——由空闲定时器管理生命周期
    scheduleBrowserClose();
  }
}

/**
 * 获取 SPA 降级提示文本（当浏览器未启用时）
 */
export function getSpaHint(): string {
  if (config.enableBrowser) {
    return ""; // 不应调用此函数
  }
  return (
    "\n\n**提示**：该页面疑似 SPA（单页应用），Readability 无法提取正文。" +
    "可设置环境变量 `MIMO_ENABLE_BROWSER=true` 启用浏览器渲染（需先安装 playwright: `npm install playwright && npx playwright install chromium`）。"
  );
}
