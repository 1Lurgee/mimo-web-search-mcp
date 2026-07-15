# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 MCP (Model Context Protocol) 服务器，将小米 MiMo 的 web_search API 包装为 Claude Code 可用的搜索工具。

## 技术栈

- **运行时**: Node.js (v20+)
- **语言**: TypeScript (strict: true)
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.x
- **参数校验**: `zod`
- **开发执行**: `tsx` (热重载)
- **编译发布**: `tsc` → `dist/`

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 编译 TypeScript
npm run build

# 启动服务器（需要设置 MIMO_API_KEY 环境变量）
npm start

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 格式化代码
npm run format
```

## 环境变量

| 变量                    | 必需 | 说明                                               |
| ----------------------- | ---- | -------------------------------------------------- |
| `MIMO_API_KEY`          | 是   | MiMo API 密钥                                      |
| `MIMO_BASE_URL`         | 否   | API 基础 URL，默认 `https://api.xiaomimimo.com/v1` |
| `REQUEST_TIMEOUT`       | 否   | 请求超时时间（毫秒），默认 `60000`                 |
| `MAX_COMPLETION_TOKENS` | 否   | 最大生成 token 数，默认 `2048`                     |
| `TEMPERATURE`           | 否   | 采样温度（0-2），默认 `0.2`                        |
| `TOP_P`                 | 否   | 核采样概率（0-1），默认 `0.95`                     |
| `DEBUG`                 | 否   | 日志级别：0=错误（默认），1=信息，2=调试           |

## 架构说明

### 目录结构

```
src/
├── index.ts      # MCP 服务器主入口
├── config.ts     # 配置管理（环境变量加载与验证）
├── logger.ts     # 日志工具
└── types.ts      # TypeScript 类型定义
```

### 技术特点

- **类型安全**: 严格 TypeScript 模式，完整的类型定义
- **模块化**: 配置、日志、类型分离
- **MCP 工具**: 注册 `mimo_web_search` 工具，支持 Zod schema 验证
- **传输协议**: stdio (标准输入/输出)

### MCP 工具

服务器注册了一个工具 `mimo_web_search`，参数：

| 参数           | 类型       | 默认值 | 说明                 |
| -------------- | ---------- | ------ | -------------------- |
| `query`        | string     | 必需   | 搜索查询             |
| `max_keyword`  | int (1-50) | 3      | 每轮最大并发关键词数 |
| `limit`        | int (1-50) | 5      | 返回结果数量         |
| `force_search` | boolean    | true   | 强制搜索             |
| `country`      | string     | 可选   | 国家                 |
| `region`       | string     | 可选   | 地区                 |
| `city`         | string     | 可选   | 城市                 |

### 调用流程

1. Claude Code 通过 stdio 连接到 MCP 服务器
2. 调用 `mimo_web_search` 工具时，服务器向 MiMo API 发送请求
3. MiMo 返回搜索结果（包含引用来源和使用统计）
4. 服务器格式化结果后返回给 Claude Code
