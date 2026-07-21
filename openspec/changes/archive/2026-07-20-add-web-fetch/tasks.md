## 1. 依赖安装与配置

- [x] 1.1 安装运行时依赖：`npm install turndown @mozilla/readability linkedom`
- [x] 1.2 在 `src/config.ts` 的 `AppConfig` 接口中新增 fetch 相关配置项（`maxFetchSize`、`fetchTimeout` 等），并在 `loadConfig()` 中添加环境变量解析
- [x] 1.3 在 `src/types.ts` 中新增 `FetchParams` 接口和 `FetchResult` 相关 Zod schema

## 2. HTTP 抓取模块

- [x] 2.1 创建 `src/fetch.ts`，实现 `fetchPage(url, signal)` 函数：HTTP GET 请求、超时控制、响应体大小限制（10MB）
- [x] 2.2 实现编码检测逻辑：Content-Type charset → HTML meta charset → 默认 UTF-8，使用 `TextDecoder` 正确解码
- [x] 2.3 实现 SSRF 防护：校验协议（仅 http/https）、检查内网 IP 黑名单（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、169.254.0.0/16、IPv6 内网）
- [x] 2.4 实现错误分类处理：DNS 失败、连接拒绝、超时、HTTP 错误状态码，返回统一的错误结构

## 3. HTML→Markdown 转换模块

- [x] 3.1 创建 `src/convert.ts`，实现 `htmlToMarkdown(html, options)` 函数
- [x] 3.2 集成 `linkedom` 创建 DOM 环境，集成 `@mozilla/readability` 提取正文
- [x] 3.3 实现 Readability 失败的三级降级：Readability 结果 → `<body>` Turndown → 提示信息 + 原始片段
- [x] 3.4 实现 `clean: false` 模式：跳过 Readability，剥离 script/style/noscript/svg/iframe 后对整个 DOM 使用 Turndown
- [x] 3.5 实现内容截断：按语义边界（段落、换行、句号）截断，复用 `search.ts` 的 `truncateContent` 逻辑思路

## 4. MCP 工具编排层

- [x] 4.1 创建 `src/fetch-tool.ts`，实现 `executeFetch(params, signal, reqId)` 函数，串联 fetch → convert → 可选 MiMo 处理
- [x] 4.2 实现无 prompt 模式：直接返回 Markdown 内容 + metadata header
- [x] 4.3 实现有 prompt 模式：将 Markdown 内容与 prompt 拼接发送给 MiMo API（chat/completions），返回 AI 处理结果
- [x] 4.4 实现 metadata header 格式：`--- Web Fetch Result ---` 包含 URL、Status、Content-Type、Size、Fetched at
- [x] 4.5 实现 MiMo API 调用失败时的 fallback：返回错误信息 + 原始 Markdown 内容

## 5. 工具注册与集成

- [x] 5.1 在 `src/server.ts` 中注册 `mimo_web_fetch` 工具，定义 Zod schema 参数（url、prompt、clean、max_length）
- [x] 5.2 编写工具描述文本，说明功能、参数、使用场景和限制（不支持 SPA）

## 6. 测试

- [x] 6.1 创建 `tests/fetch.test.ts`：测试 SSRF 防护（内网 IP、非 HTTP 协议）、编码检测、错误分类
- [x] 6.2 创建 `tests/convert.test.ts`：测试 HTML→MD 转换（标题、列表、表格、代码块、链接）、Readability 降级、clean=false 模式
- [x] 6.3 Mock fetch 测试 `fetch-tool.ts`：模拟各种 HTTP 响应（成功、404、超时、非 HTML 内容）、MiMo 处理模式
- [x] 6.4 运行 `npm run precommit` 确保 typecheck + lint + test 全部通过

## 7. 文档更新

- [x] 7.1 更新 `CLAUDE.md`：在 MCP 工具表格中新增 `mimo_web_fetch` 的参数说明
- [x] 7.2 更新 `README.md`：新增 web_fetch 功能说明、使用示例、配置项说明
