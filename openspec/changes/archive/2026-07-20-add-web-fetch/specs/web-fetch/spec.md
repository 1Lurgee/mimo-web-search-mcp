## ADDED Requirements

### Requirement: MCP 工具注册

系统 SHALL 注册名为 `mimo_web_fetch` 的 MCP 工具，接受 URL 和可选参数，返回 Markdown 格式的网页内容。

工具参数定义：

| 参数 | 类型 | 必需 | 默认值 | 约束 | 说明 |
|------|------|------|--------|------|------|
| `url` | string | 是 | — | 合法 URL，仅 http/https 协议 | 目标网页 URL |
| `prompt` | string | 否 | — | 最长 10000 字符 | 对页面内容的处理指令 |
| `clean` | boolean | 否 | true | — | 是否用 Readability 提取正文 |
| `max_length` | number | 否 | 50000 | 1000-500000 | 返回内容最大字符数 |

#### Scenario: 成功抓取并返回 Markdown
- **WHEN** 用户调用 `mimo_web_fetch` 传入 `url: "https://example.com/article"`
- **THEN** 系统返回该页面的 Markdown 格式内容，包含 metadata header（URL、Status、Content-Type、Size、Fetched at）

#### Scenario: 使用 prompt 进行 AI 处理
- **WHEN** 用户调用 `mimo_web_fetch` 传入 `url` 和 `prompt: "总结这篇文章的要点"`
- **THEN** 系统抓取页面后，将 Markdown 内容与 prompt 一起发送给 MiMo API，返回 AI 处理后的结果

#### Scenario: clean 模式切换
- **WHEN** 用户调用 `mimo_web_fetch` 传入 `clean: false`
- **THEN** 系统跳过 Readability 正文提取，直接对 HTML 使用 Turndown 转换（仍剥离 script/style 等标签）

---

### Requirement: HTTP 抓取

系统 SHALL 通过 HTTP GET 请求抓取目标 URL 的内容，支持编码检测和安全防护。

#### Scenario: 正常抓取 HTML 页面
- **WHEN** 目标 URL 返回 `Content-Type: text/html` 且状态码 200
- **THEN** 系统正确获取 HTML 内容并进行后续处理

#### Scenario: 中文 GBK 编码页面正确解码
- **WHEN** 目标 URL 返回 `Content-Type: text/html; charset=gbk` 的中文页面
- **THEN** 系统使用 GBK 编码解码，返回正确的中文内容而非乱码

#### Scenario: 自动检测 HTML meta charset
- **WHEN** Content-Type header 中没有 charset，但 HTML 的 `<meta charset="gb2312">` 声明了编码
- **THEN** 系统根据 meta charset 正确解码

#### Scenario: 非 HTML 内容直接返回
- **WHEN** 目标 URL 返回 `Content-Type: application/json` 或 `text/plain`
- **THEN** 系统跳过 HTML→MD 转换，直接返回文本内容

#### Scenario: HTTP 错误状态码
- **WHEN** 目标 URL 返回 404、500 等错误状态码
- **THEN** 系统返回包含状态码和错误信息的错误结果（`isError: true`）

#### Scenario: 请求超时
- **WHEN** 请求超过配置的超时时间（默认 60 秒）
- **THEN** 系统返回超时错误信息

#### Scenario: 响应体超过大小限制
- **WHEN** 响应体大小超过 10MB
- **THEN** 系统中止请求并返回大小超限错误信息

---

### Requirement: SSRF 防护

系统 SHALL 阻止对内网地址的请求，防止 SSRF 攻击。

#### Scenario: 阻止 loopback 地址
- **WHEN** URL 的主机为 `127.0.0.1` 或 `localhost`
- **THEN** 系统拒绝请求并返回安全错误信息

#### Scenario: 阻止私有网络地址
- **WHEN** URL 的主机为 `10.x.x.x`、`172.16.x.x`、`192.168.x.x` 等私有地址
- **THEN** 系统拒绝请求并返回安全错误信息

#### Scenario: 阻止非 HTTP 协议
- **WHEN** URL 使用 `file://`、`ftp://`、`javascript:` 等非 HTTP(S) 协议
- **THEN** 系统拒绝请求并返回安全错误信息

#### Scenario: 阻止 IPv6 内网地址
- **WHEN** URL 的主机为 `::1` 或 `fe80::` 开头的 IPv6 地址
- **THEN** 系统拒绝请求并返回安全错误信息

---

### Requirement: HTML 到 Markdown 转换

系统 SHALL 将 HTML 内容转换为结构化的 Markdown 格式。

#### Scenario: Readability 提取正文成功
- **WHEN** HTML 包含语义化标签（`<article>`、`<p>` 等），Readability 能识别正文
- **THEN** 系统使用 Readability 提取正文后用 Turndown 转换为 Markdown

#### Scenario: Readability 提取失败降级
- **WHEN** Readability 返回 null 或内容长度 < 50 字符
- **THEN** 系统降级为对 `<body>` 直接使用 Turndown 转换

#### Scenario: body 转换也极短的最终降级
- **WHEN** `<body>` 的 Turndown 转换结果也 < 100 字符
- **THEN** 系统返回提示信息 + 原始 HTML 片段

#### Scenario: clean=false 时保留非正文内容
- **WHEN** 用户传入 `clean: false`
- **THEN** 系统跳过 Readability，剥离 script/style/noscript/svg/iframe 后对整个 DOM 使用 Turndown

#### Scenario: 保留 Markdown 结构元素
- **WHEN** HTML 包含标题、列表、表格、代码块、链接等元素
- **THEN** 转换后的 Markdown 正确保留这些结构（标题层级、有序/无序列表、表格语法、代码围栏、链接语法）

---

### Requirement: 输出格式

系统 SHALL 返回包含 metadata header 的结构化输出。

#### Scenario: metadata header 格式
- **WHEN** 成功抓取并转换网页内容
- **THEN** 返回的文本以如下格式开头：
```
--- Web Fetch Result ---
URL: <实际 URL>
Status: <HTTP 状态码>
Content-Type: <响应 Content-Type>
Size: <字节数> bytes
Fetched at: <ISO 8601 时间戳>
---

<Markdown 正文内容>
```

#### Scenario: 内容截断
- **WHEN** 转换后的 Markdown 内容超过 `max_length` 参数
- **THEN** 系统在语义边界处截断并附加 `[Content truncated due to size limit...]`

#### Scenario: MiMo 处理模式的输出
- **WHEN** 用户提供了 `prompt` 参数
- **THEN** 输出为 MiMo API 的处理结果（非原始 Markdown），metadata header 中标注 `Mode: AI processed`

---

### Requirement: 错误处理

系统 SHALL 对各类异常情况返回清晰的错误信息。

#### Scenario: 无效 URL 格式
- **WHEN** 用户传入非合法 URL 格式的字符串
- **THEN** 系统返回参数校验错误（Zod 层面拦截）

#### Scenario: DNS 解析失败
- **WHEN** 目标域名无法解析
- **THEN** 系统返回 DNS 解析失败错误信息

#### Scenario: 连接被拒绝
- **WHEN** 目标服务器拒绝连接
- **THEN** 系统返回连接失败错误信息

#### Scenario: MiMo API 处理失败
- **WHEN** 用户提供了 `prompt`，但 MiMo API 返回错误
- **THEN** 系统返回 MiMo API 错误信息，同时附带原始 Markdown 内容作为 fallback
