# Claude Code 内置工具 vs 本地 MCP 对比分析

> 对比范围：Claude Code 内置 `WebFetchTool` / `WebSearchTool` 与本地运行的 `mimo-web-search-mcp`
> 日期：2026-07-21

---

## 一、架构总览

| 维度 | Claude Code 内置工具 | 本地 MCP |
|------|---------------------|----------|
| **运行位置** | Claude Code 进程内（与 IDE 一体） | 独立 MCP 服务器进程（stdio 通信） |
| **协议** | 直接调用，无协议开销 | MCP 协议（JSON-RPC over stdio） |
| **搜索 API** | Anthropic 服务端原生集成（`web_search_20250305`） | MiMo API（`/chat/completions` + web_search tool） |
| **抓取 HTTP 库** | axios（Node.js） | 原生 fetch（Node.js 18+） |
| **AI 处理模型** | Claude Haiku（小快模型） | MiMo（同一模型，搜索/分析共用） |

---

## 二、Web Search 对比

### 2.1 调用方式

| 特性 | Claude Code WebSearchTool | 本地 MCP mimo_web_search |
|------|--------------------------|--------------------------|
| **API 模式** | 服务端工具（`server_tool_use`），一次 API 调用内自动执行多轮搜索 | 客户端调用 MiMo API，API 内部执行搜索 |
| **最大搜索轮次** | 硬编码 8 次（`max_uses: 8`） | 由 MiMo API 控制（`max_keyword` 参数，1-50） |
| **流式处理** | ✅ 流式接收搜索进度（query_update、search_results_received） | ❌ 非流式（`stream: false`），等待完整响应 |
| **域名过滤** | `allowed_domains` / `blocked_domains`（API 服务端过滤） | `allowed_domains`（客户端后过滤，MiMo API 不直接支持） |
| **位置感知** | ❌ 不支持 | ✅ 支持 `country` / `region` / `city` 参数 |
| **搜索强制** | ❌ | ✅ `force_search` 参数（强制搜索即使模型认为不需要） |
| **结果去重** | 服务端处理 | ✅ 客户端引用去重（同一 URL 只显示一次） |

### 2.2 结果格式

| 特性 | Claude Code WebSearchTool | 本地 MCP mimo_web_search |
|------|--------------------------|--------------------------|
| **结果结构** | `SearchResult`（title + url 数组）+ 文本摘要混合 | 结构化文本（content + Sources 引用列表） |
| **引用格式** | JSON 数组 `{title, url}` | Markdown 链接 `[title](url) — site (date)` |
| **输出上限** | 100K 字符（`maxResultSizeChars`） | 可配置（`maxContentLength`） |

### 2.3 重试与错误处理

| 特性 | Claude Code WebSearchTool | 本地 MCP mimo_web_search |
|------|--------------------------|--------------------------|
| **重试机制** | 由 API 层统一处理 | ✅ 指数退避重试（429/5xx/超时/ECONNRESET/ECONNREFUSED） |
| **错误分类** | 简单错误码展示 | ✅ 详细分类（认证失败/限流/服务不可用/网络错误） |
| **超时控制** | 由 API 层管理 | ✅ 可配置超时（`requestTimeout`） |
| **中止支持** | ✅ AbortController | ✅ AbortSignal（区分客户端取消 vs 内部超时） |

### 2.4 模型选择

| 特性 | Claude Code WebSearchTool | 本地 MCP mimo_web_search |
|------|--------------------------|--------------------------|
| **模型策略** | 可选 Haiku（小快模型）降低延迟和成本 | 固定使用配置的 MiMo 模型 |
| **Feature Flag** | ✅ 通过 GrowthBook 控制 Haiku 开关 | ❌ 无 |

---

## 三、Web Fetch 对比

### 3.1 请求与安全

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **HTTP 升级** | ✅ HTTP → HTTPS 自动升级 | ✅ HTTP → HTTPS 自动升级 |
| **URL 最大长度** | 2000 字符 | 8192 字符 |
| **最大响应体** | 10MB（`MAX_HTTP_CONTENT_LENGTH`） | 可配置（`MAX_FETCH_SIZE`，默认 10MB） |
| **请求超时** | 60 秒（硬编码） | 可配置（`FETCH_TIMEOUT`，默认 30 秒） |
| **最大重定向** | 10 次 | 10 次 |
| **User-Agent** | 动态生成（`getWebFetchUserAgent()`） | 固定 `mimo-web-search-mcp/3.0.0` |

### 3.2 SSRF 防护

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **设计定位** | 云端/多租户，严格防护 | 本地使用，简化验证 |
| **私有 IP** | ❌ 阻止（hostname 至少 2 段） | ✅ 允许（localhost、私有 IP、任意端口） |
| **凭证 URL** | ❌ 阻止（username/password 检查） | ✅ 允许 |
| **域名黑名单** | ✅ 调用 `api.anthropic.com/api/web/domain_info` 实时检查 | ❌ 无（本地不需要） |
| **黑名单缓存** | ✅ LRU 缓存（128 条，5 分钟 TTL） | N/A |
| **Egress 代理检测** | ✅ 检测 `X-Proxy-Error: blocked-by-allowlist` | ❌ 无 |
| **跳过黑名单选项** | ✅ `skipWebFetchPreflight` 设置（企业客户） | N/A |

### 3.3 重定向处理

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **安全检查** | ✅ `isPermittedRedirect`（协议/端口/凭证/www 增减） | ✅ `isPermittedRedirect`（相同 4 项检查，对齐设计） |
| **跨域重定向** | 返回 `RedirectInfo`，提示用户手动请求 | 返回错误信息，提示用户直接请求目标 URL |
| **同域重定向** | 自动跟随 | 自动跟随（递归） |

### 3.4 HTML 转换

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **HTML 解析器** | Turndown（直接 HTML→MD） | linkedom（DOM 解析）+ Readability（正文提取）+ Turndown |
| **内容提取** | ❌ 无 Readability，直接转换整个页面 | ✅ Readability 提取正文，三级降级策略 |
| **降级策略** | 无 | ① Readability 提取 → ② 去噪 body → ③ 原始片段 |
| **噪声移除** | 无 | ✅ 移除 script/style/noscript/svg/iframe |
| **base64 清理** | ❌ | ✅ 剥离 base64 data URI（防止 token 浪费） |
| **Turndown 实例** | 懒加载 Promise 单例 | 懒加载单例 |
| **Clean/Raw 模式** | ❌ 仅一种模式 | ✅ clean（Readability）和 raw（全页面）两种模式 |

### 3.5 编码检测

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **编码检测** | ❌ 固定 UTF-8（`rawBuffer.toString('utf-8')`） | ✅ 多层检测（BOM → Content-Type → HTML meta → UTF-8） |
| **GBK 支持** | ❌ | ✅ 自动检测 Node ICU GBK 支持，给出升级提示 |
| **编码回退** | 无（直接 UTF-8 解码） | ✅ 不支持编码时回退 UTF-8 + 警告日志 |

### 3.6 流式读取

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **读取方式** | axios `arraybuffer`（一次性加载） | ✅ 流式分块读取（`streamToLimitedBuffer`） |
| **OOM 防护** | 仅 `maxContentLength` 限制 | ✅ Content-Length 预检 + 流式限流（双层防护） |
| **内存效率** | 整体加载到内存 | ✅ 分块累积，达到上限立即停止 |

### 3.7 二进制内容

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **检测策略** | `isBinaryContentType()` + `persistBinaryContent()` | ✅ 白名单策略（默认二进制，排除已知文本类型） |
| **处理方式** | 保存到磁盘 + Haiku 尝试摘要 | 直接返回不支持提示 |
| **持久化** | ✅ 保存到 `mcpOutputStorage` 目录 | ❌ 不保存（本地用户有文件系统访问能力） |

### 3.8 缓存

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **缓存库** | lru-cache | lru-cache |
| **TTL** | 15 分钟 | 5 分钟 |
| **大小上限** | 50MB | 50MB（可配置） |
| **大小计算** | 按内容字节 | 按内容字节 |
| **域名检查缓存** | ✅ 独立 LRU（128 条，5 分钟） | N/A |
| **请求去重** | ❌ | ✅ in-flight 请求去重（Map<string, Promise>） |
| **管理工具** | `clearWebFetchCache()` | ✅ MCP 工具（`mimo_cache_stats` / `mimo_cache_clear`） |

### 3.9 AI 内容处理

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **AI 处理模型** | Claude Haiku（专用小快模型） | MiMo（同一模型） |
| **Prompt 模板** | 区分 preapproved/non-preapproved（引用限制 125 字符） | 统一模板（网页内容分析助手） |
| **内容截断** | 100K 字符（`MAX_MARKDOWN_LENGTH`） | 可配置（`maxLength`，默认 50K） |
| **preapproved 域名** | ✅ 100+ 代码相关域名（免审核、无引用限制） | ❌ 无此概念 |
| **认证 URL 警告** | ✅ 提示用户 WebFetch 对认证 URL 会失败 | ❌ 无 |
| **结果持久化** | ✅ 二进制内容保存到磁盘 | ❌ |
| **自动摘要** | ✅ 内容过长时 Haiku 自动摘要 | ✅ 内容过长且启用 `autoSummary` 时 MiMo 摘要 |
| **摘要失败降级** | 返回 Haiku 原始输出 | ✅ 回退到硬截断 + 警告 |

### 3.10 SPA 处理

| 特性 | Claude Code WebFetchTool | 本地 MCP mimo_web_fetch |
|------|--------------------------|------------------------|
| **SPA 检测** | ❌ 无 | ✅ 启发式检测（div#root、__NEXT_DATA__ 等标记） |
| **浏览器渲染** | ❌ 无 | ✅ Playwright 浏览器渲染降级（可选） |
| **浏览器管理** | N/A | ✅ 实例缓存 + 空闲 30 秒自动关闭 |
| **SPA 提示** | ❌ | ✅ 未启用浏览器时附加提示信息 |

---

## 四、权限与安全模型

| 特性 | Claude Code 内置工具 | 本地 MCP |
|------|---------------------|----------|
| **权限系统** | ✅ 完整的 allow/deny/ask 规则引擎 | ❌ 无（依赖 MCP 客户端权限） |
| **域名级权限** | ✅ 每个域名独立审核 | ❌ |
| **Preapproved 域名** | ✅ 100+ 代码文档域名自动放行 | ❌ |
| **沙箱隔离** | ✅ 网络出口受沙箱控制 | ❌（本地运行，无沙箱） |
| **企业策略** | ✅ 支持 `skipWebFetchPreflight` 等企业配置 | ❌ |

---

## 五、UI 与用户体验

| 特性 | Claude Code 内置工具 | 本地 MCP |
|------|---------------------|----------|
| **工具使用提示** | ✅ `renderToolUseMessage` / `renderToolUseProgressMessage` | ❌ 由 MCP 客户端处理 |
| **进度展示** | ✅ 搜索进度（query_update、结果计数） | ❌ |
| **结果渲染** | ✅ `renderToolResultMessage`（格式化输出） | ❌ 由 MCP 客户端处理 |
| **工具摘要** | ✅ `getToolUseSummary` / `getActivityDescription` | ❌ |
| **自动分类器** | ✅ `toAutoClassifierInput`（辅助权限决策） | ❌ |

---

## 六、本地 MCP 独有优势

| 特性 | 说明 |
|------|------|
| **SPA 浏览器渲染** | Playwright 渲染 SPA 页面，Claude Code 无此能力 |
| **完整编码检测** | BOM + Content-Type + HTML meta 多层检测，支持 GBK 等中文编码 |
| **Readability 正文提取** | 三级降级策略，比纯 Turndown 转换质量更高 |
| **base64 清理** | 自动剥离 data URI，防止 token 浪费 |
| **请求去重** | in-flight 请求去重，防止并发重复抓取 |
| **缓存管理工具** | MCP 工具暴露缓存统计和清理能力 |
| **位置感知搜索** | 支持 country/region/city 精细化搜索 |
| **流式限流读取** | 双层 OOM 防护（Content-Length + 流式限流） |
| **可配置性** | 超时、大小限制、模型等均可通过环境变量配置 |
| **Zod 运行时校验** | API 响应 Schema 校验，拒绝结构不符的响应 |

---

## 七、Claude Code 内置工具独有优势

| 特性 | 说明 |
|------|------|
| **服务端搜索** | 搜索在 Anthropic 服务端执行，无需管理 API Key |
| **Haiku 小模型** | 专用小快模型处理内容，降低延迟和成本 |
| **域名黑名单** | 实时域名安全检查，阻止恶意/不可信域名 |
| **Preapproved 域名** | 100+ 代码域名自动放行，无需逐个审核 |
| **权限规则引擎** | 细粒度的 allow/deny/ask 规则，支持域名级权限 |
| **流式进度** | 搜索过程实时反馈（当前查询、结果数量） |
| **企业级安全** | 沙箱隔离、Egress 代理检测、企业策略支持 |
| **二进制持久化** | PDF 等二进制内容保存到磁盘供后续检查 |
| **引用策略** | 区分 preapproved/non-preapproved 域名的引用限制 |

---

## 八、总结

### 适用场景

- **Claude Code 内置工具**：适合云端/团队协作场景，强调安全、权限控制和服务端能力
- **本地 MCP**：适合个人本地开发场景，强调灵活性、可配置性和对中文/SPA 的支持

### 设计哲学差异

| 维度 | Claude Code | 本地 MCP |
|------|-------------|----------|
| **安全模型** | 零信任，逐域名审核 | 信任本地用户，简化验证 |
| **AI 策略** | 专用小模型（Haiku）降低成本 | 统一模型（MiMo）简化架构 |
| **错误处理** | 静默降级，用户无感 | 显式反馈，用户可控 |
| **内容提取** | 简单直接（Turndown） | 多层策略（Readability + 降级） |
| **可配置性** | 硬编码为主 | 环境变量全面可配置 |
