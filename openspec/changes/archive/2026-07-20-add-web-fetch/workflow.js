export const meta = {
  name: 'add-web-fetch',
  description: 'Implement mimo_web_fetch MCP tool: HTTP fetch, HTML→MD conversion, MiMo AI processing',
  phases: [
    { title: 'Setup', detail: 'Install deps, update config and types' },
    { title: 'Core Modules', detail: 'Implement fetch.ts and convert.ts in parallel' },
    { title: 'Integration', detail: 'Implement fetch-tool.ts, register in server.ts' },
    { title: 'Testing', detail: 'Write unit tests for all new modules' },
    { title: 'Docs & Verify', detail: 'Update CLAUDE.md/README.md, run precommit' },
  ],
}

// ── Phase 1: Setup ────────────────────────────────────────
phase('Setup')

await agent('Install runtime dependencies. Run: npm install turndown @mozilla/readability linkedom. Then verify they appear in package.json dependencies.', {
  label: 'install-deps',
  phase: 'Setup',
  effort: 'low',
})

await agent(`Update src/config.ts and src/types.ts for web_fetch support.

## Context
The project is at D:\\CodeLocal\\mimo-web-search-mcp. Read the existing files first.

## Task 1.2: Update src/config.ts
Add these fields to the AppConfig interface:
- maxFetchSize: number (default 10485760 = 10MB, env MAX_FETCH_SIZE, range 1024-104857600)
- fetchTimeout: number (default 30000ms, env FETCH_TIMEOUT, range 5000-120000)

Add the parseIntEnv calls in loadConfig() following the existing pattern.

## Task 1.3: Update src/types.ts
Add a FetchParams interface:
\`\`\`typescript
export interface FetchParams {
  url: string;
  prompt?: string;
  clean: boolean;
  maxLength: number;
}
\`\`\`

No Zod schema needed for FetchParams (it's request-side, same pattern as SearchParams).

IMPORTANT: Follow the exact coding style of the existing files. Comments in Chinese. Use the same patterns (parseIntEnv, etc).`, {
  label: 'update-config-types',
  phase: 'Setup',
})

// ── Phase 2: Core Modules (parallel) ──────────────────────
phase('Core Modules')

const [fetchModule, convertModule] = await parallel([
  () => agent(`Create src/fetch.ts - HTTP fetch module for web page retrieval.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp
Read src/search.ts and src/config.ts first to understand the coding patterns.

## Requirements

Create src/fetch.ts with these exports:

### 1. validateUrl(url: string): { valid: boolean; error?: string }
- Check protocol is http or https only (reject file://, ftp://, javascript:, etc.)
- Parse URL with new URL()
- Check hostname against private IP ranges (SSRF protection):
  - 127.0.0.0/8 (loopback)
  - 10.0.0.0/8 (private A)
  - 172.16.0.0/12 (private B)
  - 192.168.0.0/16 (private C)
  - 169.254.0.0/16 (link-local)
  - 0.0.0.0
  - ::1, fe80::/10 (IPv6)
  - localhost
- Use Node.js built-in net module for IP parsing

### 2. fetchPage(url: string, options: FetchPageOptions): Promise<FetchPageResult>
- options: { signal?: AbortSignal, maxSize?: number, timeout?: number }
- Do HTTP GET with fetch()
- Implement timeout using AbortController (similar to search.ts pattern but simpler - no retry)
- Limit response body to maxSize (default from config, 10MB)
- Detect encoding: Content-Type charset -> HTML meta charset (first 1024 bytes) -> default UTF-8
- Use TextDecoder with detected charset to decode ArrayBuffer
- Return: { url, status, contentType, size, content, error? }

### 3. Helper: detectCharset(buffer: ArrayBuffer, contentTypeHeader: string | null): string
- Parse charset from Content-Type header
- If not found, peek at first 1024 bytes for <meta charset="..."> or <meta http-equiv="Content-Type" content="...; charset=...">
- Default to utf-8

### Error handling
- Return error result (not throw) for: HTTP errors, timeout, too large, DNS failure, connection refused
- Only throw for programming errors

### Style
- Chinese comments (same as existing code)
- Import loadConfig from ./config.js and createLogger from ./logger.js
- Module-level config and logger singletons (same as search.ts)
- Export only what's needed`, {
    label: 'implement-fetch-ts',
    phase: 'Core Modules',
  }),

  () => agent(`Create src/convert.ts - HTML to Markdown conversion module.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp
Read src/search.ts first to understand truncateContent pattern and coding style.

## Requirements

Create src/convert.ts with these exports:

### 1. htmlToMarkdown(html: string, options?: ConvertOptions): string
- options: { clean?: boolean (default true), maxLength?: number (default 50000) }
- Uses linkedom to parse HTML into DOM
- Uses @mozilla/readability to extract article content (when clean=true)
- Uses turndown to convert HTML to Markdown

### Clean mode (clean=true, default):
1. Parse HTML with linkedom: parseHTML(html)
2. Create Readability instance with the document
3. Call .parse() to get article content
4. If result is null or content length < 50 chars -> FALLBACK to body
5. Convert article.content (HTML string) with Turndown
6. If result < 100 chars -> FINAL FALLBACK: return warning + raw snippet

### Fallback strategy (3 levels):
1. Readability result (>= 50 chars) -> use it
2. Readability failed -> strip <script>/<style>/<noscript>/<svg>/<iframe> from body, use Turndown on body.innerHTML
3. Body result also < 100 chars -> return "Web page content is too short or heavily relies on JavaScript rendering. Fetched content: [snippet]"

### Non-clean mode (clean=false):
- Skip Readability entirely
- Remove <script>, <style>, <noscript>, <svg>, <iframe> elements from DOM
- Convert the entire document with Turndown

### Content truncation:
- After conversion, if content exceeds maxLength, truncate at semantic boundaries
- Reuse the same logic as search.ts truncateContent (paragraph -> newline -> sentence boundaries)
- Fix broken Markdown links (dangling [ without ])
- Append truncation notice

### Turndown configuration:
- Use default TurndownService config
- headingStyle: 'atx'
- bulletListMarker: '-'
- codeBlockStyle: 'fenced'

### Style
- Chinese comments
- Import loadConfig from ./config.js and createLogger from ./logger.js
- Module-level singletons
- Clean imports: import { parseHTML } from 'linkedom', import { Readability } from '@mozilla/readability', import TurndownService from 'turndown'`, {
    label: 'implement-convert-ts',
    phase: 'Core Modules',
  }),
])

// ── Phase 3: Integration ──────────────────────────────────
phase('Integration')

await agent(`Create src/fetch-tool.ts and update src/server.ts to register the new tool.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp
Read src/search.ts, src/server.ts, src/fetch.ts (just created), src/convert.ts (just created) first.

## Task 4.1-4.5: Create src/fetch-tool.ts

Implement executeFetch(params: FetchParams, signal?: AbortSignal, reqId?: string): Promise<CallToolResult>

Flow:
1. Validate URL using validateUrl from fetch.ts
2. Fetch page using fetchPage from fetch.ts
3. If fetch error -> return error result (isError: true)
4. If content is not HTML (contentType doesn't contain 'html') -> return raw text with metadata header
5. Convert HTML to Markdown using htmlToMarkdown from convert.ts
6. If no prompt -> return markdown with metadata header
7. If prompt provided -> call MiMo API with the markdown content + prompt

### Metadata header format:
--- Web Fetch Result ---
URL: <url>
Status: <status>
Content-Type: <contentType>
Size: <size> bytes
Fetched at: <ISO 8601 timestamp>
---

When prompt is provided, add: Mode: AI processed

### MiMo API call (when prompt provided):
- Use same pattern as search.ts executeSearch for the API call
- POST to \${config.baseUrl}/chat/completions
- Headers: api-key, Content-Type
- Body: { model, messages: [system msg + user msg with markdown + prompt], max_completion_tokens, temperature, top_p, stream: false, thinking }
- System message: "你是一个网页内容分析助手。请根据用户的要求分析以下网页内容。"
- User message: "## 网页内容\\n\\n\${markdown}\\n\\n---\\n\\n## 用户要求\\n\\n\${prompt}"
- If MiMo API fails -> return error + raw markdown as fallback (don't lose the fetched content)
- Use fetchWithTimeout pattern from search.ts (create a local version, simpler, no retry)

### Import pattern:
- import { validateUrl, fetchPage } from './fetch.js'
- import { htmlToMarkdown } from './convert.js'
- import { loadConfig } from './config.js'
- import { createLogger } from './logger.js'
- import { randomUUID } from 'node:crypto'
- import type { FetchParams } from './types.js'
- import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

## Task 5.1-5.2: Update src/server.ts

Add the mimo_web_fetch tool registration AFTER the existing mimo_web_search registration.

Tool name: mimo_web_fetch
Description (English, for MCP): "Fetch web page content and convert to Markdown. Supports optional AI processing via prompt parameter. Use this to read documentation, articles, or any web page content. Returns structured Markdown with metadata. Note: Does not support JavaScript-rendered SPA pages."

Parameters (Zod schema):
- url: z.string().url().describe("The URL to fetch (http/https only)")
- prompt: z.string().max(10000).optional().describe("Optional prompt for AI processing of the content. When provided, MiMo will analyze the page content according to this prompt.")
- clean: z.boolean().default(true).describe("Extract main content using Readability (removes nav, ads, sidebars). Set to false to get full page content.")
- max_length: z.number().int().min(1000).max(500000).default(50000).describe("Maximum characters to return (1000-500000)")

Handler: call executeFetch with mapped params, using limitConcurrency wrapper (same as search tool).

Import executeFetch from './fetch-tool.js'.

IMPORTANT: Do NOT modify the existing mimo_web_search registration. Only ADD the new tool.`, {
  label: 'integrate-fetch-tool',
  phase: 'Integration',
})

// ── Phase 4: Testing ──────────────────────────────────────
phase('Testing')

const [fetchTests, convertTests, fetchToolTests] = await parallel([
  () => agent(`Create tests/fetch.test.ts - unit tests for the HTTP fetch module.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp
Read tests/search.test.ts first to understand testing patterns (vitest, mock style).
Read src/fetch.ts to understand what to test.

## Test cases to cover:

### validateUrl tests:
1. Valid https URL -> valid
2. Valid http URL -> valid
3. file:// protocol -> invalid
4. ftp:// protocol -> invalid
5. javascript: protocol -> invalid
6. 127.0.0.1 hostname -> invalid (loopback)
7. localhost hostname -> invalid
8. 10.x.x.x -> invalid (private A)
9. 172.16.x.x -> invalid (private B)
10. 192.168.x.x -> invalid (private C)
11. 169.254.x.x -> invalid (link-local)
12. 0.0.0.0 -> invalid
13. ::1 -> invalid (IPv6 loopback)
14. Normal domain (example.com) -> valid

### detectCharset tests:
1. Content-Type with charset -> use that charset
2. Content-Type without charset, HTML has <meta charset="gbk"> -> gbk
3. No charset anywhere -> utf-8

### fetchPage tests (mock global fetch):
1. Successful fetch -> returns content with correct metadata
2. HTTP 404 -> returns error result
3. HTTP 500 -> returns error result
4. Response too large -> returns size limit error
5. Timeout -> returns timeout error

Use vi.stubGlobal('fetch', mockFn) to mock fetch.
Follow the existing test patterns from search.test.ts.
Chinese comments in tests.`, {
    label: 'test-fetch',
    phase: 'Testing',
  }),

  () => agent(`Create tests/convert.test.ts - unit tests for HTML to Markdown conversion.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp
Read tests/search.test.ts first to understand testing patterns.
Read src/convert.ts to understand what to test.

## Test cases to cover:

### htmlToMarkdown with clean=true (default):
1. Article with <article> tag -> extracts and converts to MD
2. Page with nav/header/footer -> Readability strips them
3. Readability returns null -> falls back to body conversion
4. Readability returns very short content (< 50 chars) -> falls back to body
5. Body conversion also very short -> returns warning message

### htmlToMarkdown with clean=false:
1. Full page with script/style tags -> strips scripts/styles, converts rest
2. Page with noscript/svg/iframe -> strips those too
3. Preserves visible content structure

### Markdown structure preservation:
1. HTML headings -> ATX style headings (# ## ###)
2. HTML lists -> Markdown lists (- and 1.)
3. HTML links -> [text](url)
4. HTML code blocks -> fenced code blocks
5. HTML tables -> Markdown tables (if Turndown handles them)

### Content truncation:
1. Short content -> no truncation
2. Long content exceeding maxLength -> truncated with notice
3. Content with Markdown links -> no broken link syntax after truncation

Use real HTML strings as test input (no mocking needed for conversion).
Chinese comments in tests.`, {
    label: 'test-convert',
    phase: 'Testing',
  }),

  () => agent(`Create tests/fetch-tool.test.ts - unit tests for the fetch tool orchestration.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp
Read tests/search.test.ts first to understand testing patterns (how they mock fetch, test error handling).
Read src/fetch-tool.ts to understand what to test.

## Test cases to cover:

### Successful fetch (no prompt):
1. Valid URL, successful fetch -> returns markdown with metadata header
2. Metadata header contains correct URL, status, content-type, size, timestamp

### Successful fetch (with prompt):
1. Valid URL + prompt -> calls MiMo API and returns processed result
2. MiMo API response is correctly formatted

### Error cases:
1. Invalid URL (SSRF blocked) -> returns security error
2. HTTP 404 -> returns error with isError: true
3. DNS failure -> returns appropriate error
4. Non-HTML content -> returns raw text

### MiMo API fallback:
1. MiMo API returns error -> returns error + raw markdown as fallback

### Mocking strategy:
- Mock fetch.ts functions: vi.mock('./fetch.js')
- Mock convert.ts functions: vi.mock('./convert.js')
- Mock the global fetch for MiMo API calls
- Use vi.stubGlobal('fetch', mockFn) for MiMo API

Chinese comments in tests.`, {
    label: 'test-fetch-tool',
    phase: 'Testing',
  }),
])

// ── Phase 5: Docs & Verify ────────────────────────────────
phase('Docs & Verify')

await agent(`Update documentation files.

## Context
Project: D:\\CodeLocal\\mimo-web-search-mcp

## Task 7.1: Update CLAUDE.md
Read CLAUDE.md first. Find the "MCP 工具" section. Add mimo_web_fetch tool documentation.

Add to the tool parameters table:
| url | string (url) | 必需 | 目标网页 URL（仅 http/https） |
| prompt | string | 可选 | 对页面内容的 AI 处理指令 |
| clean | boolean | true | 用 Readability 提取正文去噪 |
| max_length | number | 50000 | 返回内容最大字符数 (1000-500000) |

Also add to the environment variables table:
| FETCH_TIMEOUT | 否 | 抓取超时时间（毫秒），默认 30000 |
| MAX_FETCH_SIZE | 否 | 最大响应体大小（字节），默认 10485760 (10MB) |

## Task 7.2: Update README.md
Read README.md first. Add a section about the web_fetch feature. Include:
- Feature description
- Usage example (MCP tool call)
- Parameters table
- Limitations (no SPA support)
- New environment variables

Keep the same style as the existing README content.
Chinese text for documentation.`, {
  label: 'update-docs',
  phase: 'Docs & Verify',
})

await agent('Run precommit checks to verify everything works. Run: npm run precommit', {
  label: 'verify-precommit',
  phase: 'Docs & Verify',
  effort: 'low',
})

log('All tasks complete!')
