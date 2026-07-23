# DEVLOG.md — 开发日志与演进路线

> **项目**: mimo-web-search-mcp
> **当前版本**: v3.0.0
> **最后更新**: 2026-07-22
> **维护者**: StevenZheng

---

## 1. 项目概述

### 核心功能

mimo-web-search-mcp 是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的服务器，将小米 MiMo 的 `web_search` API 与网页抓取功能封装为标准 MCP 工具，供 Claude Code 等 AI 助手调用。

### 暴露的 MCP 工具

| 工具名 | 功能 | 关键能力 |
|---|---|---|
| `mimo_web_search` | 网络搜索 | 域名白名单、多关键词并发、位置感知、引用去重 |
| `mimo_web_fetch` | 网页抓取 | HTML→Markdown 转换、Readability 正文提取、AI 处理、SPA 浏览器降级 |

### 技术栈

- **运行时**: Node.js v20+ / TypeScript 5.x (strict mode)
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.x
- **核心依赖**: zod, linkedom, @mozilla/readability, turndown, lru-cache, p-limit
- **测试**: vitest + @vitest/coverage-v8
- **工程化**: ESLint 9, Prettier, Husky (pre-commit hook)

---

## 2. 变更方向与架构演进

### 2.1 发展轨迹总览

该项目经历了三个清晰的大版本迭代，呈现出 **「单功能原型 → 模块化重构 → 平台化扩展」** 的演进路径：

```
v1.0 (初始)          v2.0 (重构)              v3.0 (扩展)
单文件 JS            TypeScript 三层架构       12 模块完整平台
 │                    │                        │
 ├─ index.js 全量      ├─ search.ts (业务)      ├─ fetch.ts (网页抓取核心)
 ├─ 仅 web_search     ├─ server.ts (协议层)    ├─ fetch-tool.ts (工具层)
 ├─ 无类型/无测试     ├─ index.ts (入口)       ├─ convert.ts (HTML→MD)
                    ├─ Zod 类型校验           ├─ ssrf.ts (安全防护)
                    ├─ ESLint/Prettier        ├─ cache.ts (LRU 缓存)
                    ├─ vitest 测试框架        ├─ render.ts (SPA 渲染)
                    └─ CI/CD (GitHub Actions) ├─ overflow.ts (溢出处理)
                                             └─ config.ts (配置管理)
```

### 2.2 核心变更方向

通过代码结构与 Git 历史分析，项目当前聚焦于以下 **四条变更方向**：

#### 方向一：模块化与关注点分离

从单文件 `index.js` 到 12 个 TypeScript 模块，每轮重构都在强化单一职责原则。关键里程碑：
- **v2.0**: 拆分出 `search.ts` / `server.ts` / `index.ts` 三层架构
- **v3.0**: 进一步拆分出 `fetch.ts` / `fetch-tool.ts` / `convert.ts` 等独立模块，搜索与抓取完全解耦

#### 方向二：安全纵深防御

安全机制从无到有、逐步加强：
- **v2.0**: 引入 Zod 参数校验，防止非法输入
- **v3.0**: 新增 SSRF 防护模块 (`ssrf.ts`)，包含私有 IP 检测和 DNS rebinding 复查；新增请求大小限制 (`MAX_FETCH_SIZE`)；URL 协议白名单

#### 方向三：性能与可靠性优化

持续优化响应速度和系统稳定性：
- **v1.0 → v2.0**: 添加超时控制与重试逻辑
- **v3.0**: LRU + TTL 缓存层、流式读取 (`maxBuffer` → 流式)、并发控制 (`p-limit`)、内容溢出智能截断

#### 方向四：工程化与开发者体验

从零基础设施到完整工程化体系：
- **v2.0**: TypeScript strict mode, ESLint/Prettier, vitest 测试, GitHub Actions CI
- **v3.0**: Husky pre-commit hook, npm 发布配置, 代码覆盖率, 完整的类型导出

---

## 3. 核心变更记录

> 按版本整理，语义化合并。标签遵循 [Keep a Changelog](https://keepachangelog.com/) 规范。

### v3.0.0 (2026-07-21)

#### [Added]
- **网页抓取工具** (`mimo_web_fetch`): 全新功能，支持抓取任意 URL 并提取正文
  - HTML→Markdown 转换 (linkedom + @mozilla/readability + turndown)
  - 可选 AI 处理 (`prompt` 参数): 将抓取内容交由 MiMo 进行摘要/问答
  - SPA 页面检测与 Playwright 浏览器渲染降级 (`MIMO_ENABLE_BROWSER`)
- **缓存系统**: 基于 `lru-cache` 的 LRU + TTL 内存缓存，提供 `mimo_cache_stats` / `mimo_cache_clear` 工具
- **SSRF 防护**: 私有 IP/保留地址检测、DNS rebinding 复查、URL 协议白名单
- **内容溢出处理**: 智能截断机制，防止超大页面耗尽内存
- **npm 发布配置**: 支持 `npx mimo-web-search-mcp` 直接运行，`bin` 入口注册
- **并发控制**: 基于 `p-limit` 的搜索并发限制

#### [Changed]
- **架构重构**: 模块从 4 个扩展到 12 个，搜索与抓取完全解耦
- **依赖升级**: `@modelcontextprotocol/sdk` 升级到 v1.29.0
- **配置管理**: 独立 `config.ts` 模块，统一加载环境变量并提供类型安全的配置对象

#### [Security]
- 新增 `ssrf.ts` 模块：防范 SSRF 攻击（私有 IP 检测、DNS 重绑定复查）
- 新增请求体大小限制 (`MAX_FETCH_SIZE` 默认 10MB)
- URL 协议仅允许 `http:` / `https:`

---

### v2.0.0 (2026-07-15)

#### [Added]
- **TypeScript 重写**: 全部源码迁移到 TypeScript，启用 `strict: true`
- **Zod 参数校验**: 所有 MCP 工具参数通过 Zod schema 定义与验证
- **测试框架**: 引入 vitest，添加搜索功能的单元测试与集成测试
- **代码质量工具链**: ESLint 9 + typescript-eslint + Prettier
- **CI/CD**: GitHub Actions 工作流（lint + typecheck + test + build）
- **请求追踪**: 为每次 API 调用生成唯一请求 ID，便于日志追踪

#### [Changed]
- **架构拆分**: 从单文件 `index.js` 拆分为三层架构
  - `search.ts` — 搜索业务逻辑（HTTP 客户端、重试、格式化）
  - `server.ts` — MCP 协议层（工具注册、并发控制）
  - `index.ts` — 启动入口（优雅关闭、信号处理）
- **类型安全**: 所有外部 API 响应定义 TypeScript 接口
- **日志系统**: 引入 `logger.ts`，通过 `DEBUG` 环境变量控制日志级别

#### [Fixed]
- 配置默认值与文档不一致问题 (temperature 0.3, max_completion_tokens 1024)
- ESLint 配置忽略 `vitest.config.ts` 和 `coverage/` 目录

---

### v1.0.0 (2026-07-15，初始版本)

#### [Added]
- 初始发布：基于 MiMo API 的 MCP 网络搜索服务器
- 单文件 JavaScript 实现 (`index.js`)
- 基础搜索功能：query、limit、country/region/city 参数
- 超时控制与自动重试机制
- `DEBUG` 环境变量控制日志输出

---

## 4. 当前状态与技术债

### 4.1 代码质量指标

| 指标 | 状态 | 说明 |
|---|---|---|
| TypeScript strict | ✅ 启用 | `tsconfig.json` 配置 `strict: true` |
| 类型覆盖率 | ✅ 良好 | 所有模块均有类型定义 |
| 测试覆盖 | ⚠️ 部分 | 仅 `search.ts` 和 `convert.ts` 有测试，`fetch.ts`/`ssrf.ts`/`cache.ts` 缺失 |
| CI/CD | ✅ 运行中 | GitHub Actions 自动执行 lint + typecheck + test + build |
| 文档完整度 | ⚠️ 基本 | README 覆盖使用说明，但缺少 API 文档和架构图 |

### 4.2 已识别的技术债

#### 🔴 高优先级

1. **测试覆盖不足**
   - `src/fetch.ts` — 网页抓取核心逻辑无单元测试（编码检测、流式读取、超时处理）
   - `src/ssrf.ts` — SSRF 防护逻辑无测试（私有 IP 检测、DNS 复查）
   - `src/cache.ts` — LRU 缓存行为未验证（TTL 过期、LRU 淘汰）
   - `src/server.ts` — 工具注册与调用流程仅通过集成测试间接覆盖

2. **search.ts 重试机制薄弱**
   - `fetchWithRetry` 使用递归实现，无最大深度限制
   - 重试间隔为固定 1 秒，未采用指数退避
   - 对比 `fetch.ts` 的流式处理和优雅错误处理，搜索模块显得粗糙

#### 🟡 中优先级

3. **错误处理不一致**
   - `fetch-tool.ts:120-125` — 外层 catch 对业务错误添加了冗余的 "网页抓取失败: " 前缀，导致错误消息层级混乱
   - `ssrf.ts:71` — 错误信息硬编码中文字符串，不利于国际化
   - `search.ts` — 部分 HTTP 错误状态码未区分处理（如 429 限流 vs 500 服务端错误）

4. **fetch-tool.ts 副作用问题**
   - 工具函数 `handleWebFetch` 同时负责业务逻辑和 MCP 工具注册（违反 SRP）
   - 依赖全局 `urlCache` 单例，不利于测试和多实例部署

#### 🟢 低优先级

5. **未使用的能力**
   - `McpServer.tool()` 第三个参数注册了 `ListChangedRequestSchema`，但回调为空函数 `() => {}`，属于废弃 API 模式
   - `config.ts` 中 `enableBrowser` 配置已加载但 Playwright 为可选依赖，缺少运行时能力检测的用户提示
   - `README.md` 中 API 基础 URL 文档 (`https://api.xiaomimimo.com/v1`) 与实际环境变量默认值未做同步校验

6. **缺少类型导出**
   - `package.json` 未配置 `types` 字段，npm 发布后消费者无法获得类型提示
   - `ZodSchemas`、`SearchResponse` 等核心类型未从入口文件导出

---

## 5. 下一步规划建议

基于变更方向和技术债分析，为项目提出以下演进建议：

### 建议一：补全测试覆盖（优先级：🔴 最高）

**目标**: 将测试覆盖率从 ~30% 提升到 80%+

- 为 `ssrf.ts` 添加边界测试（私有 IP、DNS 重绑定模拟）
- 为 `fetch.ts` 添加编码检测、超时、大文件截断测试
- 为 `cache.ts` 添加 TTL 过期、LRU 淘汰、并发访问测试
- 引入 `msw` (Mock Service Worker) 模拟 HTTP 响应，解耦网络依赖

### 建议二：搜索模块可靠性增强

**目标**: 让 `search.ts` 达到 `fetch.ts` 同等的健壮性

- 将 `fetchWithRetry` 改为迭代实现 + 指数退避 + 抖动
- 区分可重试错误 (网络超时, 429, 5xx) 与不可重试错误 (4xx)
- 添加搜索结果的结构化校验 (Zod safeParse)

### 建议三：错误体系标准化

**目标**: 统一错误处理模式，提升可调试性

- 定义项目级错误类型层级 (`McpError` → `NetworkError` / `ValidationError` / `SsrfError`)
- 错误消息使用错误码前缀 (如 `SSRF_PRIVATE_IP`)，支持国际化
- `fetch-tool.ts` 中移除冗余的错误包装，保留原始错误链

### 建议四：npm 包完善与类型导出

**目标**: 让 npm 包成为一等公民

- 在 `package.json` 添加 `"types": "dist/index.d.ts"` 字段
- 从 `src/index.ts` 导出公共类型 (`SearchResponse`, `FetchOptions`, `ZodSchemas`)
- 添加 `.npmignore` 或优化 `files` 字段，排除测试文件和开发配置
- 考虑添加 `exports` 字段支持 ESM/CJS 双格式

### 建议五：可观测性增强

**目标**: 从日志级别控制升级为结构化可观测性

- 引入结构化日志 (JSON 格式)，便于生产环境采集
- 为每次 MCP 工具调用添加耗时统计 (p50/p99)
- 考虑添加 OpenTelemetry 集成，追踪请求全链路

---

## 附录：架构依赖关系

```
index.ts ─────────────────────────────────────┐
  │  (启动入口：优雅关闭、信号处理)              │
  ▼                                            ▼
server.ts                                    config.ts
  │  (MCP 协议层：工具注册、并发控制)            │  (环境变量加载)
  │                                            │
  ├──── search.ts                              │
  │       (搜索：HTTP 客户端、重试、格式化)       │
  │                                            │
  ├──── fetch-tool.ts ←────────────────────────┤
  │       (抓取工具层：validate → fetch →        │
  │        convert → AI)                        │
  │         │                                   │
  │         ├── fetch.ts                        │
  │         │     (流式读取、编码检测、超时)       │
  │         │                                   │
  │         ├── convert.ts                      │
  │         │     (HTML→Markdown: Readability    │
  │         │      + Turndown)                   │
  │         │                                   │
  │         ├── ssrf.ts                         │
  │         │     (私有 IP 检测、DNS 复查)        │
  │         │                                   │
  │         ├── cache.ts                        │
  │         │     (LRU + TTL 缓存)              │
  │         │                                   │
  │         ├── render.ts                       │
  │         │     (Playwright SPA 渲染)         │
  │         │                                   │
  │         └── overflow.ts                     │
  │               (内容溢出智能截断)              │
  │                                            │
  └── logger.ts                                │
        (日志工具：console.error，               │
         不污染 MCP stdio)                      │
                                                │
types.ts ←─────────────────────────────────────┘
  (Zod schema + TypeScript 类型定义)
```

---

*本文档基于代码分析与 Git 历史自动生成，建议随版本发布同步更新。*
