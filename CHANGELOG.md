# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-07-21

### Added
- **网页抓取功能** (`mimo_web_fetch`)
  - 支持抓取指定 URL 的网页内容
  - 自动提取正文内容（使用 Readability）
  - HTML 转 Markdown 格式化
  - 支持 AI 处理（通过 prompt 参数）
  - SPA 页面浏览器渲染降级（Playwright）

- **缓存系统** (`FetchCache`)
  - LRU 缓存机制（最大 50 条目）
  - 5 分钟 TTL 自动过期
  - ~~缓存统计和清除 API (`mimo_cache_stats`, `mimo_cache_clear`)~~ — 已移除，缓存对调用方透明

- **内容溢出处理** (`overflow.ts`)
  - 智能截断（按语义边界）
  - 防止 token 浪费

- **Base64 Data URI 剥离**
  - 自动移除内嵌的 base64 数据
  - 防止 token 浪费

- **URL 校验 + 重定向约束**（本地部署简化版）
  - 仅允许 `http` / `https`，限制 URL 长度
  - **有意允许** localhost、私有 IP、任意端口、URL 凭证（方便本机/内网调试）
  - 自动重定向仅跟随同协议/同端口/同主机（允许 www 增减）
  - **不做**私有 IP 阻止、端口 allowlist、DNS rebinding 复查
  - 不适合暴露给不可信远程用户或多租户环境

- **引用去重**
  - 搜索结果中同一 URL 只保留首次出现
  - 防止重复引用污染上下文

- **域名白名单** (`allowed_domains`)
  - 支持限制搜索结果来源域名

- **配置脱敏** (`getRedactedConfig`)
  - API Key 安全打印（显示为 `***REDACTED***`）

### Changed
- **架构重构**：三层架构（search/server/index）
  - `search.ts` - 搜索业务逻辑
  - `server.ts` - MCP 协议层
  - `index.ts` - 启动入口

- **TypeScript 重构**
  - 完整的类型定义
  - Zod schema 验证
  - 严格的类型检查

### Removed
- 移除面向多租户/远程托管场景的严格 SSRF 控件（本项目仅本地单用户使用）
  - 私有 IP / localhost 阻止
  - 凭证检测
  - 单标签主机拒绝
  - 端口 allowlist
  - DNS rebinding 防护

### Fixed
- 修复 ESLint 配置问题
- 修复测试覆盖率报告
- 修复 GitHub Actions CI/CD 流水线
- 同步测试与文档到本地简化安全策略（去掉“严格 SSRF 已启用”的假象）

## [2.0.0] - 2026-07-15

### Changed
- TypeScript 重构
- 引入 ESLint/Prettier 代码规范
- 日志级别控制（DEBUG 环境变量）
- 统一文档与代码默认值

## [1.0.0] - 2026-07-10

### Added
- 初始版本发布
- MiMo web_search API 封装
- MCP 协议支持
- Claude Code 集成

---

## Release Notes

### v3.0.0 主要特性

这是项目的重要升级版本，主要新增了网页抓取功能和缓存系统：

1. **网页抓取**：可以抓取任意 URL 的网页内容，自动提取正文并转换为 Markdown 格式
2. **智能缓存**：避免重复抓取，提升性能
3. **内容优化**：自动剥离 base64 数据、智能截断，节省 token
4. **本地安全策略**：协议/重定向约束 + 本机与内网可达（非远程多租户 SSRF 防护）

### 升级指南

从 v2.x 升级到 v3.0.0：

1. **环境变量**：无需更改，向后兼容
2. **MCP 工具**：新增 `mimo_web_fetch`、`mimo_cache_stats`、`mimo_cache_clear`
3. **配置**：可选启用浏览器渲染（`MIMO_ENABLE_BROWSER=true`）

### 安装方式

```bash
# npm 全局安装（推荐）
npm install -g mimo-web-search-mcp

# 或直接运行
npx mimo-web-search-mcp
```

### Claude Code 配置

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
