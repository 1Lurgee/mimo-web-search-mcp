## Context

当前 MCP 服务器 (`mimo-web-search-mcp`) 仅提供 `mimo_web_search` 工具，通过 MiMo API 执行搜索查询并返回结果摘要。服务器采用三层架构：`search.ts`（业务逻辑）、`server.ts`（MCP 协议层）、`index.ts`（启动入口），共享 `config.ts`、`logger.ts`、`types.ts`。

用户需要新增网页抓取能力，因为 Claude Code 自带的 `web_fetch` 工具在网络环境下不可用。目标是实现一个功能对齐的替代方案，作为 MCP 工具提供给 Claude Code。

**约束条件**：
- 仅需考虑中国大陆网络环境
- 不需要代理配置
- 个人使用 + 开源项目
- 不需要成本控制

## Goals / Non-Goals

**Goals:**
- 新增 `mimo_web_fetch` MCP 工具，接受 URL 返回 Markdown 格式的网页内容
- 支持可选的 `prompt` 参数，用 MiMo 模型对页面内容进行 AI 处理（摘要/问答）
- 使用 `@mozilla/readability` 提取正文去噪，`turndown` 转换 Markdown
- 正确处理中文网页编码（GBK/GB2312）
- 防止 SSRF 攻击（内网 IP 黑名单、协议限制）
- 与现有架构风格保持一致（模块分层、Zod 校验、重试/超时模式）

**Non-Goals:**
- 不处理需要 JavaScript 渲染的 SPA 页面（Readability 基于静态 HTML）
- 不实现页面截图或 PDF 生成
- 不支持需要登录认证的页面
- 不实现自动重试（页面不存在重试无意义，与 search 不同）
- 不做 MiMo token 成本控制

## Decisions

### D1: 模块分层 — 三文件分离

**决策**：新建三个文件 `fetch.ts`、`convert.ts`、`fetch-tool.ts`，分别负责 HTTP 抓取、HTML→MD 转换、MCP 工具编排。

**理由**：对齐现有 `search.ts` 的分层风格。`fetch.ts` 和 `convert.ts` 是纯函数，不依赖 MCP SDK，可独立测试。`fetch-tool.ts` 串联两者并处理 MiMo 交互。

**替代方案**：
- 合并为单文件 `fetch.ts` — 太臃肿，HTTP 逻辑和转换逻辑关注点不同
- 复用 `search.ts` 的 `fetchWithTimeout` — 但 search.ts 的 HTTP 工具函数是模块私有的，且 web_fetch 不需要重试逻辑，保持独立更简洁

### D2: HTML→MD 转换方案 — Turndown + Readability + linkedom

**决策**：使用 `turndown`（HTML→MD）+ `@mozilla/readability`（正文提取）+ `linkedom`（轻量 DOM）组合。

**理由**：
- Turndown 是 Node.js 生态最成熟的 HTML→MD 库，处理表格、列表、代码块都有现成规则
- Readability 是 Firefox 阅读模式的同款算法，能有效去除导航栏、广告、侧边栏等噪音
- linkedom 比 jsdom（~2MB）轻 10 倍，只提供 Readability 需要的 DOM API

**替代方案**：
- 自研正则转换 — 维护成本高，边界情况多，不现实
- cheerio + 手动转换 — 200KB 依赖且需要大量手写规则
- @aspect-build/parse5-html-to-markdown — 不如 Turndown 成熟

### D3: 编码检测策略 — 分级检测

**决策**：采用分级编码检测：Content-Type header → HTML meta charset → 默认 UTF-8，fallback GBK。

**理由**：中国大陆大量网站使用 GBK/GB2312 编码，`fetch().text()` 默认 UTF-8 会乱码。Node.js 内置 `TextDecoder` 支持 gbk、gb2312 等编码，无需额外依赖。

**实现**：
1. 优先从 `Content-Type` header 解析 charset
2. 未找到则检查 HTML 前 1024 字节的 `<meta charset="...">` 或 `<meta http-equiv="Content-Type" content="...; charset=...">`
3. 都没有则默认 UTF-8

### D4: 安全防护 — SSRF 防御

**决策**：限制协议为 http/https，禁止内网 IP 地址段。

**禁止的地址段**：
- `127.0.0.0/8`（loopback）
- `10.0.0.0/8`（私有网络 A 类）
- `172.16.0.0/12`（私有网络 B 类）
- `192.168.0.0/16`（私有网络 C 类）
- `169.254.0.0/16`（link-local）
- `::1`、`fe80::/10`（IPv6 内网）
- `0.0.0.0`

**实现**：使用 Node.js 内置 `net.isIPv4()` / `net.isIPv6()` 解析 IP，检查是否在禁止范围内。对域名不做额外限制（DNS 解析后的 IP 检查可通过后续增强实现）。

### D5: Readability 失败的 Fallback 策略

**决策**：三级降级策略。

1. Readability 返回有效内容（`length >= 50`）→ 使用 Readability 结果
2. Readability 返回 null 或过短 → 降级为对 `<body>` 直接使用 Turndown
3. `<body>` 转换结果也极短（`< 100` 字符）→ 返回提示信息 + 原始片段

**理由**：Table 布局和重 JS 渲染的页面可能无法被 Readability 正确解析，但至少应该返回一些内容而非空白。

### D6: `clean: false` 模式的处理

**决策**：跳过 Readability，但仍剥离 `<script>`、`<style>`、`<noscript>`、`<svg>`、`<iframe>` 等非内容标签后用 Turndown 转换。

**理由**：用户可能需要查看 SEO meta 信息、结构化数据等非正文内容，但 `<script>` 等标签不应出现在 Markdown 输出中。

### D7: MiMo 处理模式 — 直接发送

**决策**：当用户提供 `prompt` 时，将完整 Markdown 内容与 prompt 拼接后直接发送给 MiMo API。

**理由**：MiMo Pro 支持 1M token 上下文窗口，绝大多数网页内容在限制内。通过 `config.maxContentLength` 控制截断即可，不需要分块处理等复杂策略。

**消息格式**：
```
messages: [
  { role: "system", content: "你是一个网页内容分析助手。请根据用户的要求分析以下网页内容。" },
  { role: "user", content: `## 网页内容\n\n${markdown}\n\n---\n\n## 用户要求\n\n${prompt}` }
]
```

### D8: 工具参数设计

**决策**：对齐 Claude Code 的 WebFetch 风格，4 个参数。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string (url) | 必需 | 目标 URL |
| `prompt` | string | 可选 | 对内容的处理指令（有则调用 MiMo） |
| `clean` | boolean | true | 用 Readability 提取正文 |
| `max_length` | number | 50000 | 返回内容最大字符数 |

### D9: 与 search.ts 的共享 — 保持独立

**决策**：`fetch.ts` 自己实现简单的 HTTP 抓取逻辑，不复用 `search.ts` 的 `fetchWithTimeout`。

**理由**：
- web_fetch 场景比 search 简单：单次请求、不重试、超时即可
- search.ts 的 HTTP 工具函数是模块私有的，提取到共享模块会增加改动范围
- 两个工具的 HTTP 行为不同（search 有重试、区分超时与取消；fetch 不需要）

## Risks / Trade-offs

### R1: 重 JS 渲染的 SPA 页面无法处理
**风险**：Readability 基于静态 HTML 解析，无法处理 React/Vue 等框架渲染的 SPA 页面。
**缓解**：在工具描述中说明此限制。用户遇到此场景可使用 Playwright MCP 等工具替代。
**接受**：作为 v1 的已知限制，后续可考虑集成 headless browser。

### R2: Turndown 对复杂 HTML 的转换质量
**风险**：某些复杂嵌套的 HTML 结构（如多层嵌套表格、iframe 嵌入）可能产生不理想的 Markdown。
**缓解**：Turndown 社区活跃，有丰富的插件和规则定制能力。v1 先用默认配置，后续根据实际使用情况调整。

### R3: linkedom 的 DOM API 兼容性
**风险**：linkedom 是轻量 DOM 实现，可能不支持 Readability 依赖的某些边缘 DOM API。
**缓解**：linkedom 是 Readability 的推荐搭配方案，社区验证充分。如遇问题可切换到 jsdom（体积更大但兼容性更全）。

### R4: 大页面的内存和性能
**风险**：超大页面（>10MB）可能导致内存占用过高。
**缓解**：在 HTTP 层限制响应体大小（默认 10MB），超限直接截断并返回错误提示。

### R5: SSRF 防御的完整性
**风险**：当前方案仅检查 URL 中的 IP 地址，不检查 DNS 解析后的 IP。攻击者可通过 DNS 重绑定绕过。
**缓解**：作为个人使用的本地工具，DNS 重绑定攻击风险极低。后续可增强为解析后检查。
