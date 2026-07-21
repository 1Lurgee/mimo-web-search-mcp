## Why

当前 MCP 服务器仅有 `mimo_web_search` 一个工具，只能返回搜索结果摘要和引用来源，无法获取网页的完整内容。用户（包括 Claude Code Agent）经常需要阅读特定 URL 的完整页面内容——例如查看文档全文、阅读博客文章、提取 API 参考等。Claude Code 自带的 `web_fetch` 工具因网络环境问题无法使用，需要一个本地替代方案。

## What Changes

- **新增 `mimo_web_fetch` MCP 工具**：接受 URL，抓取网页内容，转换为 Markdown 返回
- **新增 HTML → Markdown 转换能力**：使用 `@mozilla/readability` 提取正文 + `turndown` 转换 Markdown
- **新增可选的 MiMo AI 处理模式**：传入 `prompt` 参数时，用 MiMo 模型对页面内容进行摘要/问答
- **新增安全防护**：协议限制、内网 IP 黑名单（防 SSRF）、响应体大小限制、超时控制
- **新增中文编码检测**：自动处理 GBK/GB2312 编码的中文网页

## Capabilities

### New Capabilities

- `web-fetch`: 网页抓取与 Markdown 转换能力——包括 HTTP 抓取、编码检测、HTML 解析（Readability 提取正文）、Markdown 转换（Turndown）、可选的 MiMo AI 处理、安全防护（SSRF 防御）

### Modified Capabilities

（无。现有 `mimo_web_search` 工具不受影响）

## Impact

- **新增文件**：`src/fetch.ts`、`src/convert.ts`、`src/fetch-tool.ts`、`tests/fetch.test.ts`、`tests/convert.test.ts`
- **修改文件**：`src/server.ts`（注册新工具）、`src/config.ts`（新增 fetch 相关配置项）、`src/types.ts`（新增 fetch 参数类型）
- **新增依赖**：`turndown`、`@mozilla/readability`、`linkedom`
- **不影响**：现有 `mimo_web_search` 的行为和 API 完全不变
