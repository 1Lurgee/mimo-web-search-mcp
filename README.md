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

### 方式 1：npm 全局安装（推荐）

```bash
# 全局安装
npm install -g mimo-web-search-mcp

# 或直接运行（无需安装）
npx mimo-web-search-mcp
```

### 方式 2：从源码安装

```bash
# 克隆并安装
git clone https://github.com/1Lurgee/mimo-web-search-mcp.git
cd mimo-web-search-mcp
npm install
npm run build
```

### Claude Code 配置

编辑 `~/.claude.json` 文件（Windows: `%USERPROFILE%\.claude.json`）：

#### 使用 npm 全局安装（推荐）

```json
{
  "mcpServers": {
    "mimo-web-search": {
      "command": "npx",
      "args": ["mimo-web-search-mcp"],
      "env": {
        "MIMO_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### 使用源码安装

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

### 必需变量

| 变量                    | 说明                          |
| ----------------------- | ----------------------------- |
| `MIMO_API_KEY`          | MiMo API 密钥                 |

### 可选变量

| 变量                    | 说明                                        | 默认值                           |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| `MIMO_BASE_URL`         | API 基础 URL                                | `https://api.xiaomimimo.com/v1` |
| `MIMO_MODEL`            | 模型名称（如 `mimo-v2.5`、`mimo-v2.5-pro`） | `mimo-v2.5`                      |
| `MIMO_THINKING`         | 启用思考模式                                | `false`                          |
| `MIMO_AUTO_SUMMARY`     | 超长内容自动摘要                            | `true`                           |
| `MIMO_ENABLE_BROWSER`   | 启用浏览器渲染（SPA 降级）                  | `false`                          |
| `DEBUG`                 | 日志级别：`0`=错误，`1`=信息，`2`+=调试    | `0`                              |
| `REQUEST_TIMEOUT`       | MiMo API 请求超时（毫秒）                  | `60000`                          |
| `MAX_COMPLETION_TOKENS` | 最大生成 token 数                           | `1024`                           |
| `TEMPERATURE`           | 采样温度（0 ~ 1.5）                        | `0.3`                            |
| `TOP_P`                 | 核采样概率（0.01 ~ 1.0）                   | `0.95`                           |
| `MAX_RETRIES`           | 最大重试次数（0 ~ 10）                      | `2`                              |
| `RETRY_DELAY`           | 重试延迟（毫秒，100 ~ 60000）              | `1000`                           |
| `MAX_CONTENT_LENGTH`    | 最大内容长度（字节）                        | `100000`                         |
| `MAX_CONCURRENT`        | 最大并发请求数（1 ~ 100）                   | `10`                             |
| `DEFAULT_MAX_KEYWORD`   | 默认最大关键词数（1 ~ 50）                  | `3`                              |
| `DEFAULT_LIMIT`         | 默认返回结果数（1 ~ 50）                    | `5`                              |
| `MAX_QUERY_LENGTH`      | 查询最大字符数（100 ~ 100000）              | `10000`                          |
| `FETCH_TIMEOUT`         | 网页抓取超时时间（毫秒）                    | `30000`                          |
| `MAX_FETCH_SIZE`        | 最大响应体大小（字节）                      | `10485760` (10MB)                |

## 开发

```bash
npm run dev          # 开发模式（热重载）
npm run build        # 编译 TypeScript
npm test             # 运行测试
npm run precommit    # 提交前完整检查
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
