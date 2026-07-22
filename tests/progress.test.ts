import { describe, it, expect, vi } from "vitest";
import { createProgressReporter } from "../src/progress.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";

describe("createProgressReporter", () => {
  it("应使用正确的 progressToken 和参数发送通知", async () => {
    const mockSendNotification = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter(mockSendNotification, "test-token");

    await reporter.report(50, "测试进度...");

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: {
        progressToken: "test-token",
        progress: 50,
        message: "测试进度...",
      },
    });
  });

  it("应支持数值类型的 progressToken", async () => {
    const mockSendNotification = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter(mockSendNotification, 42);

    await reporter.report(100, "完成");

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ progressToken: 42 }),
      }),
    );
  });

  it("无 progressToken 时应为 no-op", async () => {
    const mockSendNotification = vi.fn();
    const reporter = createProgressReporter(mockSendNotification, undefined);

    await reporter.report(50, "测试进度...");

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("progressToken 为 null 时应为 no-op", async () => {
    const mockSendNotification = vi.fn();
    const reporter = createProgressReporter(mockSendNotification, null as unknown as undefined);

    await reporter.report(50, "测试进度...");

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("无 sendNotification 时应为 no-op", async () => {
    const reporter = createProgressReporter(undefined, "test-token");

    // 不应抛出异常
    await reporter.report(50, "测试进度...");
  });

  it("sendNotification 抛出异常时应静默忽略", async () => {
    const mockSendNotification = vi.fn().mockRejectedValue(new Error("连接已断开"));
    const reporter = createProgressReporter(mockSendNotification, "test-token");

    // 不应抛出异常
    await reporter.report(50, "测试进度...");

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
  });

  it("应支持连续多次发送进度", async () => {
    const mockSendNotification = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter(mockSendNotification, "test-token");

    await reporter.report(0, "开始...");
    await reporter.report(50, "进行中...");
    await reporter.report(100, "完成");

    expect(mockSendNotification).toHaveBeenCalledTimes(3);
    expect(mockSendNotification).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ params: expect.objectContaining({ progress: 0 }) }),
    );
    expect(mockSendNotification).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ params: expect.objectContaining({ progress: 50 }) }),
    );
    expect(mockSendNotification).toHaveBeenNthCalledWith(3,
      expect.objectContaining({ params: expect.objectContaining({ progress: 100 }) }),
    );
  });
});
