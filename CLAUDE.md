# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 MCP (Model Context Protocol) 服务器，将小米 MiMo 的 web_search API 和网页抓取功能包装为 Claude Code 可用的工具。

**部署模型**：本地单用户使用。`mimo_web_fetch` 故意允许访问 localhost、私有 IP、任意端口与 URL 内凭证，以便调试本机/内网服务；**不要**把本服务暴露给不可信远程用户或共享多租户环境。

## 技术栈

- **运行时**: Node.js (v20+)
- **语言**: TypeScript (strict: true)
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.x
- **参数校验**: `zod`
- **开发执行**: `tsx` (热重载)
- **编译发布**: `tsc` → `dist/`

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（热重载）
npm run build        # 编译 TypeScript
npm start            # 启动服务器（需要 MIMO_API_KEY）
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm run format       # 格式化代码
npm test             # 运行测试（vitest）
npm run precommit    # 提交前完整检查
```

## 环境变量

| 变量                    | 必需 | 说明                                                      |
| ----------------------- | ---- | --------------------------------------------------------- |
| `MIMO_API_KEY`          | 是   | MiMo API 密钥                                             |
| `MIMO_BASE_URL`         | 否   | API 基础 URL，默认 `https://api.xiaomimimo.com/v1`        |
| `DEBUG`                 | 否   | 日志级别：`0`=错误（默认），`1`=信息，`2`=调试            |
| `FETCH_TIMEOUT`         | 否   | 抓取超时时间（毫秒），默认 `30000`                        |
| `MAX_FETCH_SIZE`        | 否   | 最大响应体大小（字节），默认 `10485760`（10MB）            |
| `MIMO_ENABLE_BROWSER`   | 否   | 启用浏览器渲染（SPA 降级），默认 `false`                  |

## 架构说明

### 目录结构

```
src/
├── index.ts      # 启动入口（优雅关闭、信号处理）
├── server.ts     # MCP 协议层（工具注册、并发控制）
├── search.ts     # 搜索业务逻辑（HTTP 客户端、重试、格式化）
├── fetch.ts      # 网页抓取核心（流式读取、编码检测、超时）
├── fetch-tool.ts # 网页抓取 MCP 工具层（validate→fetch→convert→AI）
├── convert.ts    # HTML 转 Markdown（linkedom + Readability + Turndown）
├── ssrf.ts       # URL 校验（本地简化）+ redactUrl 脱敏 + 同域重定向检查
├── cache.ts      # 网页抓取缓存（LRU + TTL）
├── render.ts     # SPA 浏览器渲染降级（Playwright）
├── overflow.ts   # 内容溢出处理（智能截断）
├── config.ts     # 配置管理（环境变量加载与验证）
├── logger.ts     # 日志工具（console.error，不污染 MCP stdio）
└── types.ts      # Zod schema + TypeScript 类型定义
```

### MCP 工具

- `mimo_web_search` - 网络搜索（支持域名白名单）
- `mimo_web_fetch` - 网页抓取（支持 AI 处理、SPA 降级）

### 本地安全策略（有意简化）

| 能力 | 行为 |
| ---- | ---- |
| 协议 | 仅允许 `http` / `https` |
| 私有 IP / localhost | **允许**（本地调试需要） |
| 端口 | **不限制** |
| URL 凭证 `user:pass@` | **允许**（请求侧保留；日志与元数据头经 `redactUrl` 脱敏） |
| DNS rebinding 复查 | **不做** |
| 自动重定向 | 仅跟随同协议/同端口/同主机（允许 www 增减），跨主机需调用方直接请求目标 URL |
| `MIMO_BASE_URL` | 强制 HTTPS |
| 响应体 | 大小上限 + 流式截断，二进制类型拒绝 |

### 调用流程

1. Claude Code 通过 stdio 连接到 MCP 服务器
2. 调用工具时，服务器校验参数并执行相应逻辑
3. 搜索：向 MiMo API 发送请求，格式化结果（引用去重）
4. 抓取：校验 URL（协议/格式）→ 检查缓存 → 流式读取 → HTML 转 Markdown → 可选 AI 处理
5. SPA 页面自动检测，可选 Playwright 浏览器渲染
