/** SPA 浏览器渲染降级模块 - 当网页为 SPA 且启用浏览器时，用 Playwright 渲染 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

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
 * 检测 HTML 是否疑似 SPA（单页应用）
 * 启发式规则：
 * 1. clean 转换后的 markdown 内容过短（< 200 字符）
 * 2. 原始 HTML 包含 SPA 典型标记（div#root、__NEXT_DATA__ 等）
 */
export function isSpaPage(html: string, markdownLength: number): boolean {
  // markdown 内容足够长，不是 SPA
  if (markdownLength >= 200) return false;

  // 检查 HTML 中的 SPA 标记
  return SPA_MARKERS.some((pattern) => pattern.test(html));
}

// ── Playwright 浏览器渲染 ─────────────────────────────

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
    logger.info(`启动浏览器渲染: ${url}`);
    browser = await playwright.chromium.launch({ headless: true });

    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout,
    });

    // 等待页面稳定（SPA 路由和数据加载完成后）
    await page.waitForTimeout(1000);

    const html = await page.content();
    logger.info(`浏览器渲染完成: ${url} (${html.length} 字符)`);

    return { html, success: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(`浏览器渲染失败: ${error.message}`);
    return {
      html: "",
      success: false,
      error: `浏览器渲染失败: ${error.message}`,
    };
  } finally {
    await browser?.close().catch(() => "");
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
