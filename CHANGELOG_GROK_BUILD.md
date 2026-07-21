# 借鉴 grok-build 优化实施记录

## 设计原则

**本地部署、本地用户使用** - 不过度防护，保留实用功能

---

## Web Fetch 借鉴

### 1. Base64 Data URI 剥离 ✅

**文件**: `src/convert.ts`

- 手动扫描实现（高性能，避免正则回溯）
- 防止 token 浪费
- 支持多参数 header 和大小写不敏感匹配

### 2. FetchCache 缓存 ✅

**文件**: `src/cache.ts`

- 统一 TTL（5分钟），不区分截断/完整内容
- 简单 LRU 淘汰（最大 50 条目）
- 全局单例 `globalFetchCache`
- 缓存统计和清除 API

### 3. 内容溢出处理 ✅

**文件**: `src/overflow.ts`

- 智能截断（按语义边界）
- 移除了保存到磁盘功能

---

## Web Search 借鉴

### 1. 引用去重 ✅

**文件**: `src/search.ts`

- 同一 URL 只保留首次出现
- 保持首次出现顺序
- 防止重复引用污染上下文

**借鉴来源**: grok-build `client.rs:280-301`

### 2. Config Redacted ✅

**文件**: `src/config.ts`

- `getRedactedConfig()` 函数
- api_key 替换为 "***REDACTED***"
- 安全打印配置到日志

**借鉴来源**: grok-build `types.rs:33-49`

---

## 已实施的搜索增强

### 1. 域名白名单 ✅

**文件**: `src/server.ts`, `src/search.ts`, `src/types.ts`

- 新增 `allowed_domains` 参数
- 支持限制搜索结果来源域名

### 2. 缓存管理工具 ✅

**文件**: `src/server.ts`

- `mimo_cache_stats` - 查看缓存统计
- `mimo_cache_clear` - 清除缓存

---

## 已移除的过度设计

| 移除项 | 原因 |
|--------|------|
| SSRF 私有 IP 阻止 | 本地需要访问 localhost、192.168.x.x |
| 凭证检测 | 本地可能需要 `http://user:pass@localhost:8080` |
| 单标签主机拒绝 | 本地可能有 `http://myapp/` 服务 |
| 端口 allowlist | 本地可能用任意端口 |
| DNS rebinding 防护 | 本地攻击向量不现实 |
| 归因回调机制 | 直接写日志即可 |
| Magic bytes 验证 | 用户信任自己的文件 |
| Accept Header 优先 markdown | 可能导致问题 |

---

## 代码量对比

| 模块 | 简化前 | 简化后 |
|------|--------|--------|
| ssrf.ts | ~300 行 | ~60 行 |
| attribution.ts | ~85 行 | ~30 行 |
| cache.ts | ~135 行 | ~90 行 |
| overflow.ts | ~110 行 | ~60 行 |
| media.ts | ~180 行 | ~100 行 |

---

## 测试结果

```
Test Files  9 passed (9)
     Tests  197 passed (197)
  Duration  17.47s
```

---

## 总结

### Web Fetch 借鉴
- ✅ Base64 剥离（防 token 浪费）
- ✅ 缓存机制（提升性能）
- ✅ 智能截断（按语义边界）

### Web Search 借鉴
- ✅ 引用去重（防重复污染）
- ✅ Config redacted（安全日志）
- ✅ 域名白名单（提高相关性）
