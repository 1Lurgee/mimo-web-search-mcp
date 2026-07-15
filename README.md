# MiMo Web Search MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的服务器，将小米 MiMo 的 `web_search` API 封装为标准 MCP 工具，让 Claude Code 等 AI 助手能够进行实时网络搜索。

## 功能特性

- 🔍 **实时网络搜索** - 获取最新的网络信息
- 📊 **结构化结果** - 返回标题、URL、摘要和来源引用
- 🌍 **位置感知搜索** - 支持按国家/地区/城市进行本地化搜索
- 🔄 **自动重试** - 内置重试机制和超时控制
- 📝 **详细日志** - 通过 DEBUG 环境变量控制日志级别
- 🛡️ **类型安全** - 完整的 TypeScript 类型定义

## 前置要求

- Node.js >= 20.0.0
- MiMo API Key（从 [MiMo 平台](https://mimo.xiaomi.com) 获取）

## 获取源码

```bash
git clone https://github.com/your-username/mimo-web-search-mcp.git
cd mimo-web-search-mcp
npm install
npm run build
```

## 配置

### Claude Code 配置

编辑 `~/.claude.json` 文件（Windows 用户路径为 `%USERPROFILE%\.claude.json`）：

```json
{
  "mcpServers": {
    "mimo-web-search": {
      "type": "stdio",
      "command": "node",
      "args": ["<项目路径>/dist/index.js"],
      "env": {
        "MIMO_API_KEY": "your-api-key-here",
        "MIMO_BASE_URL": "https://api.xiaomimimo.com/v1"
      }
    }
  }
}
```

将 `<项目路径>` 替换为实际路径，例如：
- Windows: `D:/CodeLocal/mimo-web-search-mcp/dist/index.js`
- macOS/Linux: `/home/user/mimo-web-search-mcp/dist/index.js`

### 环境变量

| 变量                    | 必需 | 说明                                                      | 默认值                              |
| ----------------------- | ---- | --------------------------------------------------------- | ----------------------------------- |
| `MIMO_API_KEY`          | 是   | MiMo API 密钥                                             | -                                   |
| `MIMO_BASE_URL`         | 否   | API 基础 URL                                              | `https://api.xiaomimimo.com/v1`    |
| `MIMO_MODEL`            | 否   | 模型名称                                                  | `mimo-v2.5-pro`                    |
| `REQUEST_TIMEOUT`       | 否   | 请求超时时间（毫秒）                                      | `60000`                            |
| `MAX_COMPLETION_TOKENS` | 否   | 最大生成 token 数                                         | `1024`                             |
| `TEMPERATURE`           | 否   | 采样温度（0-2）                                           | `0.3`                              |
| `TOP_P`                 | 否   | 核采样概率（0-1）                                         | `0.95`                             |
| `MIMO_STREAM`           | 否   | 启用流式响应                                              | `false`                            |
| `MIMO_THINKING`         | 否   | 启用思考模式                                              | `false`                            |
| `DEBUG`                 | 否   | 日志级别：`0`=错误（默认），`1`=信息，`2`=调试；或命名空间模式 `mimo*` 等 | `0`                 |
| `MAX_RETRIES`           | 否   | 最大重试次数                                              | `2`                                |
| `RETRY_DELAY`           | 否   | 重试延迟基数（毫秒）                                      | `1000`                             |
| `MAX_CONTENT_LENGTH`    | 否   | 响应内容最大字符数                                        | `100000`                           |
| `MAX_CONCURRENT`        | 否   | 最大并发请求数                                            | `10`                               |
| `DEFAULT_MAX_KEYWORD`   | 否   | 默认最大关键词数                                          | `3`                                |
| `DEFAULT_LIMIT`         | 否   | 默认返回结果数                                            | `5`                                |
| `MAX_QUERY_LENGTH`      | 否   | 查询最大字符数                                            | `10000`                            |

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式（热重载）

```bash
npm run dev
```

### 编译 TypeScript

```bash
npm run build
```

### 类型检查

```bash
npm run typecheck
```

### 代码检查

```bash
npm run lint
```

### 测试

```bash
# 运行所有测试（vitest，提交前必跑）
npm test

# 监听模式
npm run test:watch

# 带覆盖率
npm run test:coverage

# 提交前完整检查（类型检查 + ESLint + 测试）
npm run precommit
```

## 使用方法

配置完成后，Claude Code 会自动识别并可用 `mimo_web_search` 工具。

### 在 Claude Code 中使用

直接提问即可，Claude 会自动调用搜索工具：

```
用户: 今天北京天气怎么样？
Claude: [自动调用 mimo_web_search 查询北京天气]
```

### 工具参数

| 参数           | 类型       | 默认值 | 说明                               |
| -------------- | ---------- | ------ | ---------------------------------- |
| `query`        | string     | 必需   | 搜索查询（最多 10000 字符）       |
| `max_keyword`  | int (1-50) | 3      | 每轮最大并发关键词数（每个 ¥0.025） |
| `limit`        | int (1-50) | 5      | 返回结果数量                       |
| `force_search` | boolean    | true   | 即使模型认为知道答案也强制搜索     |
| `country`      | string     | 可选   | 国家（如 'China'）                |
| `region`       | string     | 可选   | 地区/省份（如 'Hubei'）           |
| `city`         | string     | 可选   | 城市（如 'Wuhan'）                |

### 示例响应

```
根据搜索结果，北京今天天气晴朗，气温 25°C...

--- Sources ---
- [北京天气预报](https://weather.com/beijing) — 中国天气网 (2025-01-15)
- [北京实时天气](https://www.weather.com.cn) — 中国气象局 (2025-01-15)
```

## 项目结构

```
mimo-web-search-mcp/
├── src/
│   ├── index.ts      # MCP 服务器主入口
│   ├── config.ts     # 配置管理（环境变量加载与验证）
│   ├── logger.ts     # 日志工具
│   └── types.ts      # Zod schema + TypeScript 类型定义
├── tests/
│   ├── config.test.ts   # 配置模块测试
│   ├── logger.test.ts   # 日志模块测试
│   └── search.test.ts   # 搜索逻辑测试（mock fetch）
├── dist/             # 编译输出（自动忽略）
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── CLAUDE.md
├── README.md
└── LICENSE
```

## 安全说明

本 MCP 服务器仅作为 MiMo 搜索 API 的透传层，不对返回内容做提示词注入过滤。防御提示词注入是 Client 端（Claude Code 等）的职责，建议在使用搜索结果时保持警惕。

## 错误处理

服务器会分类处理各种错误情况：

- **认证错误** (401/403)：提示检查 API 密钥
- **速率限制** (429)：提示稍后重试
- **服务器错误** (5xx)：提示服务暂时不可用
- **超时错误**：提示服务响应缓慢
- **网络错误**：提示检查网络连接

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 贡献

欢迎提交 Issue 和 Pull Request！

## 致谢

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MiMo API](https://mimo.xiaomi.com)
- [Claude Code](https://docs.anthropic.com/claude-code)
