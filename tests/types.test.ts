import { describe, it, expect } from "vitest";
import {
  AnnotationSchema,
  WebSearchUsageSchema,
  UsageSchema,
  MessageSchema,
  ChoiceSchema,
  MimoResponseSchema,
} from "../src/types.js";

// ── AnnotationSchema ──────────────────────────────────

describe("AnnotationSchema", () => {
  it("完整合法对象通过校验", () => {
    const result = AnnotationSchema.safeParse({
      title: "Example",
      site_name: "example.com",
      url: "https://example.com",
      publish_time: "2025-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("空对象通过校验（所有字段可选）", () => {
    const result = AnnotationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("允许额外字段（passthrough）", () => {
    const result = AnnotationSchema.safeParse({ title: "t", extra_field: true });
    expect(result.success).toBe(true);
  });

  it("字段类型错误时拒绝", () => {
    const result = AnnotationSchema.safeParse({ title: 123 });
    expect(result.success).toBe(false);
  });
});

// ── WebSearchUsageSchema ──────────────────────────────

describe("WebSearchUsageSchema", () => {
  it("完整对象通过校验", () => {
    const result = WebSearchUsageSchema.safeParse({ tool_usage: 2, page_usage: 5 });
    expect(result.success).toBe(true);
  });

  it("空对象通过校验", () => {
    const result = WebSearchUsageSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("字段类型错误时拒绝", () => {
    const result = WebSearchUsageSchema.safeParse({ tool_usage: "two" });
    expect(result.success).toBe(false);
  });
});

// ── UsageSchema ───────────────────────────────────────

describe("UsageSchema", () => {
  it("完整对象通过校验", () => {
    const result = UsageSchema.safeParse({
      total_tokens: 100,
      prompt_tokens: 50,
      completion_tokens: 50,
      web_search_usage: { tool_usage: 1, page_usage: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("空对象通过校验（所有字段可选）", () => {
    const result = UsageSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("web_search_usage 嵌套对象类型错误时拒绝", () => {
    const result = UsageSchema.safeParse({ web_search_usage: "invalid" });
    expect(result.success).toBe(false);
  });

  it("token 数量为负数时通过校验（Zod 无 .min() 约束）", () => {
    // 验证当前 schema 不做数值范围校验——这是 API 响应校验，不做业务校验
    const result = UsageSchema.safeParse({ total_tokens: -1 });
    expect(result.success).toBe(true);
  });
});

// ── MessageSchema ─────────────────────────────────────

describe("MessageSchema", () => {
  it("完整对象通过校验", () => {
    const result = MessageSchema.safeParse({
      content: "test content",
      annotations: [{ title: "t", url: "https://example.com" }],
    });
    expect(result.success).toBe(true);
  });

  it("空对象通过校验（所有字段可选）", () => {
    const result = MessageSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("annotations 数组元素类型错误时拒绝", () => {
    const result = MessageSchema.safeParse({ annotations: ["not-an-object"] });
    expect(result.success).toBe(false);
  });

  it("content 为数字时拒绝", () => {
    const result = MessageSchema.safeParse({ content: 123 });
    expect(result.success).toBe(false);
  });
});

// ── ChoiceSchema ──────────────────────────────────────

describe("ChoiceSchema", () => {
  it("包含 message 的对象通过校验", () => {
    const result = ChoiceSchema.safeParse({ message: { content: "ok" } });
    expect(result.success).toBe(true);
  });

  it("空对象通过校验（message 可选）", () => {
    const result = ChoiceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("message 为字符串时拒绝", () => {
    const result = ChoiceSchema.safeParse({ message: "invalid" });
    expect(result.success).toBe(false);
  });
});

// ── MimoResponseSchema ────────────────────────────────

describe("MimoResponseSchema", () => {
  it("完整合法响应通过校验", () => {
    const result = MimoResponseSchema.safeParse({
      choices: [
        {
          message: {
            content: "搜索结果",
            annotations: [{ title: "标题", url: "https://example.com" }],
          },
        },
      ],
      usage: {
        total_tokens: 200,
        prompt_tokens: 100,
        completion_tokens: 100,
        web_search_usage: { tool_usage: 2, page_usage: 5 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("空对象通过校验（所有字段可选）", () => {
    const result = MimoResponseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("choices 为空数组通过校验", () => {
    const result = MimoResponseSchema.safeParse({ choices: [] });
    expect(result.success).toBe(true);
  });

  it("choices 非数组时拒绝", () => {
    const result = MimoResponseSchema.safeParse({ choices: "invalid" });
    expect(result.success).toBe(false);
  });

  it("允许额外字段（passthrough）", () => {
    const result = MimoResponseSchema.safeParse({
      choices: [{ message: { content: "ok" } }],
      id: "chatcmpl-123",
      model: "mimo-v2.5-pro",
    });
    expect(result.success).toBe(true);
  });

  it("嵌套 choices[0].message 类型错误时拒绝", () => {
    const result = MimoResponseSchema.safeParse({
      choices: [{ message: { content: 123 } }],
    });
    expect(result.success).toBe(false);
  });

  it("usage 字段类型错误时拒绝", () => {
    const result = MimoResponseSchema.safeParse({ usage: "not-an-object" });
    expect(result.success).toBe(false);
  });

  it("非对象类型拒绝（null / string / number）", () => {
    expect(MimoResponseSchema.safeParse(null).success).toBe(false);
    expect(MimoResponseSchema.safeParse("string").success).toBe(false);
    expect(MimoResponseSchema.safeParse(42).success).toBe(false);
    expect(MimoResponseSchema.safeParse([1, 2]).success).toBe(false);
  });
});
