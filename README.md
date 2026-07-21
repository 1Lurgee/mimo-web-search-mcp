# MiMo Web Search MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的服务器，将小米 MiMo 的 `web_search` API 封装为标准 MCP 工具，让 Claude Code 等 AI 助手能够进行实时网络搜索。

## 功能特性

- 🔍 **实时网络搜索** - 获取最新的网络信息
- 🌐 **网页抓取** - 抓取并提取指定 URL 的网页正文内容
- 📊 **结构化结果** - 返回标题、URL、摘要和来源引用
- 🔄 **自动重试** - 内置重试机制和超时控制
- 📝 **详细日志** - 通过 DEBUG 环境变量控制日志级别
- 🛡️ **类型安全** - 完整的 TypeScript 类型定义

## 前置要求

- Node.js >= 20.0.0
- MiMo API Key（从 [MiMo 平台](https://mimo.xiaomi.com) 获取）

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/1Lurgee/mimo-web-search-mcp.git
cd mimo-web-search-mcp
npm install
npm run build
```

### Claude Code 配置

编辑 `~/.claude.json` 文件（Windows: `%USERPROFILE%\.claude.json`）：

```json
{
  "mcpServers": {
    "mimo-web-search": {
      "type": "stdio",
      "command": "node",
      "args": ["<项目路径>/dist/index.js"],
      "env": {
        "MIMO_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## 使用方法

配置完成后，Claude Code 会自动识别并可用以下工具：

### mimo_web_search - 网络搜索

```
用户: 今天北京天气怎么样？
Claude: [自动调用 mimo_web_search 查询北京天气]
```

**主要参数**：`query`（必需）、`limit`（结果数量）、`country`/`region`/`city`（位置）

### mimo_web_fetch - 网页抓取

```
用户: 帮我看看这篇文章 https://example.com/article
Claude: [自动调用 mimo_web_fetch 抓取网页内容]
```

**主要参数**：`url`（必需）、`prompt`（AI 处理指令）、`clean`（提取正文）

**注意**：SPA 页面（React/Vue）需要设置 `MIMO_ENABLE_BROWSER=true` 并安装 playwright。

## 环境变量

| 变量                    | 必需 | 说明                          | 默认值                           |
| ----------------------- | ---- | ----------------------------- | -------------------------------- |
| `MIMO_API_KEY`          | 是   | MiMo API 密钥                 | -                                |
| `MIMO_BASE_URL`         | 否   | API 基础 URL                  | `https://api.xiaomimimo.com/v1` |
| `DEBUG`                 | 否   | 日志级别：`0`=错误，`1`=信息  | `0`                              |
| `FETCH_TIMEOUT`         | 否   | 抓取超时时间（毫秒）          | `30000`                          |
| `MAX_FETCH_SIZE`        | 否   | 最大响应体大小（字节）        | `10485760` (10MB)                |
| `MIMO_ENABLE_BROWSER`   | 否   | 启用浏览器渲染（SPA 降级）    | `false`                          |

## 开发

```bash
npm run dev          # 开发模式（热重载）
npm run build        # 编译 TypeScript
npm test             # 运行测试
npm run precommit    # 提交前完整检查
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
