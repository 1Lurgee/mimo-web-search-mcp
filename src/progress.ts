/** 进度通知工具 - 封装 MCP notifications/progress 发送 */

import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";

/** 发送通知函数类型（来自 RequestHandlerExtra.sendNotification） */
type SendNotificationFn = (notification: ServerNotification) => Promise<void>;

/** 进度报告器接口 */
export interface ProgressReporter {
  /**
   * 发送进度更新
   * - progressToken 不存在时为 no-op
   * - 发送失败时静默忽略（不影响工具主流程）
   */
  report(progress: number, message: string): Promise<void>;
}

/** 空操作报告器（客户端未请求进度时使用） */
const noopReporter: ProgressReporter = {
  async report() {
    // no-op
  },
};

/**
 * 创建进度报告器
 *
 * @param sendNotification - MCP SDK 的 sendNotification 函数
 * @param progressToken - 客户端请求中的 progressToken（来自 _meta）
 * @returns ProgressReporter 实例
 */
export function createProgressReporter(
  sendNotification?: SendNotificationFn,
  progressToken?: string | number,
): ProgressReporter {
  // 无 token 或无 sendNotification → 返回 no-op
  if (progressToken === undefined || progressToken === null || !sendNotification) {
    return noopReporter;
  }

  return {
    async report(progress: number, message: string): Promise<void> {
      try {
        await sendNotification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress,
            message,
          },
        } as ServerNotification);
      } catch {
        // 静默忽略：进度通知失败不应影响工具主流程
      }
    },
  };
}
