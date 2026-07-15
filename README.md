# MiMo Web Search MCP Server

一个将小米 MiMo 的 web_search API 包装为 Claude Code 可用的 MCP 工具的服务器。

## 功能特性

- 🔍 实时网络搜索：使用小米 MiMo 的 web_search 插件进行实时搜索
- 📍 位置感知搜索：支持按国家、地区、城市进行本地化搜索
- 🔄 自动重试：网络错误或服务暂时不可用时自动重试
- ⏱️ 超时控制：防止请求无限期挂起
- 🛡️ 错误处理：友好的错误提示和恢复建议
- 🧹 优雅关闭：正确处理进程信号和异常

## 安装

```bash
npm install
```

## 配置

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `MIMO_API_KEY` | 是 | MiMo API 密钥 |
| `MIMO_BASE_URL` | 否 | API 基础 URL，默认 `https://api.xiaomimimo.com/v1` |
| `REQUEST_TIMEOUT` | 否 | 请求超时时间（毫秒），默认 `30000` |

### Claude Code 配置

在 Claude Code 的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "mimo-web-search": {
      "command": "node",
      "args": ["path/to/mimo-web-search-mcp/server.mjs"],
      "env": {
        "MIMO_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## 使用方法

### MCP 工具

服务器提供一个工具：`mimo_web_search`

#### 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | 必需 | 搜索查询 |
| `max_keyword` | int (1-50) | 3 | 每轮最大并发关键词数 |
| `limit` | int (1-50) | 5 | 返回结果数量 |
| `force_search` | boolean | false | 强制搜索 |
| `country` | string | 可选 | 国家 |
| `region` | string | 可选 | 地区 |
| `city` | string | 可选 | 城市 |

#### 示例

```json
{
  "query": "最新的人工智能进展",
  "max_keyword": 5,
  "limit": 10,
  "country": "China"
}
```

### 返回格式

成功响应：
```
搜索结果内容...

--- Sources ---
- [标题](URL) — 网站名 (发布时间)

--- Usage ---
Search calls: 3, Pages: 10
Tokens: 1500 (prompt: 500, completion: 1000)
```

错误响应：
```
错误描述和恢复建议
```

## 错误处理

服务器会分类处理各种错误情况：

- **认证错误** (401/403)：提示检查 API 密钥
- **速率限制** (429)：提示稍后重试
- **服务器错误** (5xx)：提示服务暂时不可用
- **超时错误**：提示服务响应缓慢
- **网络错误**：提示检查网络连接

## 开发

### 项目结构

```
mimo-web-search-mcp/
├── server.mjs          # MCP 服务器主文件
├── package.json        # 项目配置
├── CLAUDE.md           # Claude Code 指令
└── README.md           # 项目说明
```

### 技术栈

- **运行时**: Node.js (ESM 模块)
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.x
- **传输协议**: stdio (标准输入/输出)
- **验证**: Zod schema

## 许可证

MIT License
