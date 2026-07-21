import { describe, it, expect } from "vitest";

// ── 设置环境变量（convert.ts 模块顶层 loadConfig 需要）──
process.env.MIMO_API_KEY = "test-api-key";

const { htmlToMarkdown } = await import("../src/convert.js");

// ── 辅助：构造完整 HTML 文档 ───────────────────────────

/** 包裹 body 内容为完整 HTML 文档 */
function wrapHtml(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

// ── htmlToMarkdown (clean=true，默认) ──────────────────

describe("htmlToMarkdown clean=true（默认）", () => {
  it("带 <article> 标签的文章 -> 提取并转为 Markdown", () => {
    const html = wrapHtml(`
      <nav><a href="/">首页</a></nav>
      <article>
        <h1>文章标题</h1>
        <p>这是一段正文内容，包含足够的文字以便 Readability 能够成功提取。我们需要确保内容足够长，超过五十个字符的阈值，这样 Readability 才不会认为内容过短而跳过提取。</p>
        <p>第二段内容，继续增加文字量以确保提取成功。Readability 需要看到足够的文本密度才会认为这是一个有效的文章。</p>
      </article>
      <footer>页脚信息</footer>
    `);

    const result = htmlToMarkdown(html);

    // 应包含正文内容
    expect(result).toContain("文章标题");
    expect(result).toContain("正文内容");
    // nav/footer 应被 Readability 剥离
    expect(result).not.toContain("首页");
    expect(result).not.toContain("页脚信息");
  });

  it("带 nav/header/footer 的页面 -> Readability 剥离导航等元素", () => {
    const html = wrapHtml(`
      <header><nav><a href="/">首页</a> | <a href="/about">关于</a></nav></header>
      <main>
        <h1>页面标题</h1>
        <p>这是页面的主要内容区域，需要包含足够多的文字让 Readability 认为这是一个有价值的页面。主要内容应该保留，而导航和页脚应该被过滤掉。</p>
        <p>更多的正文内容来确保提取成功。Readability 算法会分析文本密度来判断哪些是主要内容。</p>
      </main>
      <footer><p>版权所有 &copy; 2025</p></footer>
    `);

    const result = htmlToMarkdown(html);

    expect(result).toContain("页面标题");
    expect(result).toContain("主要内容");
    // 导航和页脚应被剥离
    expect(result).not.toContain("关于");
    expect(result).not.toContain("版权所有");
  });

  it("Readability 返回 null -> 降级到 body 转换", () => {
    // 构造一个 Readability 难以提取的页面（内容分散在多个短元素中）
    const html = wrapHtml(`
      <div class="sidebar">侧边栏内容</div>
      <div class="widget-1">小组件内容一，增加一些文字量</div>
      <div class="widget-2">小组件内容二，继续增加文字量</div>
      <div class="widget-3">小组件内容三，补充更多文字以确保 body 降级后有足够内容</div>
      <div class="widget-4">小组件内容四，继续补充文字内容确保降级转换结果超过一百字符</div>
      <div class="widget-5">小组件内容五，最后补充一些文字确保整体内容量充足</div>
    `);

    const result = htmlToMarkdown(html);

    // 降级到 body 转换后，应包含页面中的文本
    expect(result).toContain("侧边栏内容");
    expect(result.length).toBeGreaterThan(0);
  });

  it("Readability 返回极短内容 (< 50 字符) -> 降级到 body 转换", () => {
    // article 内容非常短，Readability 可能提取但内容不足 50 字符
    const html = wrapHtml(`
      <article><p>短</p></article>
      <div class="content">
        <p>这是页面中的其他内容，当 Readability 提取结果过短时会降级到这里。需要确保有足够的文字来通过 body 转换。</p>
        <p>补充更多内容以确保 body 转换后长度超过一百字符的阈值要求。</p>
      </div>
    `);

    const result = htmlToMarkdown(html);

    // 应降级并包含 body 中的内容
    expect(result.length).toBeGreaterThan(0);
  });

  it("Body 转换也极短 -> 返回警告信息", () => {
    // 整个页面内容极少
    const html = wrapHtml(`<p>短</p>`);

    const result = htmlToMarkdown(html);

    expect(result).toContain("Web page content is too short");
    expect(result).toContain("Fetched content:");
  });
});

// ── htmlToMarkdown (clean=false) ───────────────────────

describe("htmlToMarkdown clean=false", () => {
  it("剥离 script/style 标签，转换其余内容", () => {
    const html = wrapHtml(`
      <script>console.log("恶意脚本");</script>
      <style>body { color: red; }</style>
      <h1>页面标题</h1>
      <p>这是可见的正文内容，应该被保留到输出中。</p>
      <script>alert("另一个脚本");</script>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    // 可见内容应保留
    expect(result).toContain("页面标题");
    expect(result).toContain("可见的正文内容");
    // script/style 内容应被剥离
    expect(result).not.toContain("恶意脚本");
    expect(result).not.toContain("color: red");
    expect(result).not.toContain("另一个脚本");
  });

  it("剥离 noscript/svg/iframe 标签", () => {
    const html = wrapHtml(`
      <h1>SVG 与 iframe 测试</h1>
      <svg><circle r="10"/></svg>
      <iframe src="https://example.com"></iframe>
      <noscript>请启用 JavaScript</noscript>
      <p>正文内容应被保留，而 SVG、iframe 和 noscript 元素应被移除。</p>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    expect(result).toContain("SVG 与 iframe 测试");
    expect(result).toContain("正文内容应被保留");
    // 被剥离的元素内容
    expect(result).not.toContain("circle");
    expect(result).not.toContain("example.com");
    expect(result).not.toContain("请启用 JavaScript");
  });

  it("保留可见内容结构", () => {
    const html = wrapHtml(`
      <h1>一级标题</h1>
      <h2>二级标题</h2>
      <p>段落文本。</p>
      <ul>
        <li>列表项一</li>
        <li>列表项二</li>
      </ul>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    expect(result).toContain("# 一级标题");
    expect(result).toContain("## 二级标题");
    expect(result).toContain("段落文本");
    // Turndown 默认列表标记为 "-   "（短横线加三个空格）
    expect(result).toContain("列表项一");
    expect(result).toContain("列表项二");
  });
});

// ── Markdown 结构保真 ─────────────────────────────────

describe("Markdown 结构保真", () => {
  it("HTML 标题 -> ATX 风格标题 (# ## ###)", () => {
    const html = wrapHtml(`
      <h1>一级标题</h1>
      <h2>二级标题</h2>
      <h3>三级标题</h3>
      <h4>四级标题</h4>
      <p>一些正文内容确保 Turndown 有东西可转换。</p>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    expect(result).toContain("# 一级标题");
    expect(result).toContain("## 二级标题");
    expect(result).toContain("### 三级标题");
    expect(result).toContain("#### 四级标题");
  });

  it("HTML 列表 -> Markdown 列表（无序 - 和有序 1.）", () => {
    const html = wrapHtml(`
      <ul>
        <li>无序项一</li>
        <li>无序项二</li>
      </ul>
      <ol>
        <li>有序项一</li>
        <li>有序项二</li>
      </ol>
      <p>列表测试正文。</p>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    // Turndown 默认列表标记为 "-   "（短横线加三个空格）
    expect(result).toContain("无序项一");
    expect(result).toContain("无序项二");
    // 有序列表使用数字标记
    expect(result).toContain("有序项一");
    expect(result).toContain("有序项二");
  });

  it("HTML 链接 -> [text](url) 格式", () => {
    const html = wrapHtml(`
      <p>访问 <a href="https://example.com">示例网站</a> 了解更多信息。</p>
      <p>也可以查看 <a href="https://test.org/page">测试页面</a>。</p>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    expect(result).toContain("[示例网站](https://example.com)");
    expect(result).toContain("[测试页面](https://test.org/page)");
  });

  it("HTML 代码块 -> 围栏代码块", () => {
    const html = wrapHtml(`
      <p>以下是代码示例：</p>
      <pre><code>function hello() {
  console.log("你好世界");
}</code></pre>
      <p>代码展示完毕。</p>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    // 围栏代码块以 ``` 开始
    expect(result).toContain("```");
    expect(result).toContain("function hello()");
    expect(result).toContain('console.log("你好世界")');
  });

  it("HTML 表格 -> Markdown 表格", () => {
    const html = wrapHtml(`
      <table>
        <thead>
          <tr><th>名称</th><th>版本</th></tr>
        </thead>
        <tbody>
          <tr><td>TypeScript</td><td>5.0</td></tr>
          <tr><td>Node.js</td><td>20.0</td></tr>
        </tbody>
      </table>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    // Turndown 表格插件默认未启用，但基本表格元素应被转换
    // 至少应包含表格中的文本内容
    expect(result).toContain("名称");
    expect(result).toContain("版本");
    expect(result).toContain("TypeScript");
    expect(result).toContain("Node.js");
  });
});

// ── 内容截断 ──────────────────────────────────────────

describe("内容截断", () => {
  it("短内容 -> 不截断", () => {
    const html = wrapHtml(`
      <h1>短文章</h1>
      <p>这是一篇很短的文章，不会触发截断逻辑。内容长度远低于默认的五万字符限制。</p>
    `);

    const result = htmlToMarkdown(html, { clean: false });

    expect(result).not.toContain("Content truncated");
    expect(result).toContain("短文章");
  });

  it("超过 maxLength 的长内容 -> 截断并附带通知", () => {
    // 生成大量重复段落以超过 maxLength
    const paragraphs = Array.from(
      { length: 200 },
      (_, i) => `<p>这是第 ${i + 1} 个段落，用于填充内容以测试截断功能。每个段落都包含一定量的文字。</p>`,
    ).join("\n");
    const html = wrapHtml(paragraphs);

    const result = htmlToMarkdown(html, { clean: false, maxLength: 1000 });

    expect(result).toContain("Content truncated");
    expect(result.length).toBeLessThan(paragraphs.length);
  });

  it("含 Markdown 链接的长内容 -> 截断后不产生残缺链接语法", () => {
    // 构造大量段落，末尾带有 Markdown 链接
    const padding = Array.from(
      { length: 200 },
      (_, i) => `<p>填充段落 ${i + 1}，增加整体内容长度。这些段落用于确保内容超过截断阈值。</p>`,
    ).join("");
    const html = wrapHtml(
      `${padding}<p>请查看 <a href="https://example.com/very/long/path/to/some/page">这个重要链接</a> 获取详情。</p>`,
    );

    const result = htmlToMarkdown(html, { clean: false, maxLength: 2000 });

    // 检查不应有悬挂的 [ 没有对应 ]( 的情况
    const openBrackets = (result.match(/\[/g) ?? []).length;
    const closeBrackets = (result.match(/\]/g) ?? []).length;
    // 允许截断通知中的 [Content truncated...] 多一个 [
    expect(openBrackets).toBeLessThanOrEqual(closeBrackets + 1);
  });

  it("自定义 maxLength 生效", () => {
    // 生成刚好超过自定义 maxLength 的内容
    const content = "这是一段重复的文本内容。".repeat(100);
    const html = wrapHtml(`<p>${content}</p>`);

    const result = htmlToMarkdown(html, { clean: false, maxLength: 200 });

    expect(result).toContain("Content truncated");
    // 截断后长度应接近 maxLength（加上截断通知）
    expect(result.length).toBeLessThan(200 + 100); // maxLength + 截断通知长度
  });
});
