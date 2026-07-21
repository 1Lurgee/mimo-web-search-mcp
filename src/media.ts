/**
 * 媒体文件处理模块（简化版）
 *
 * 本地使用简化：
 * - 移除 Magic bytes 验证（用户信任自己的文件）
 * - 简化保存逻辑
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "./logger.js";

// ── 模块级单例 ────────────────────────────────────────

import { loadConfig } from "./config.js";
const config = loadConfig();
const logger = createLogger(config);

// ── 类型定义 ──────────────────────────────────────────

/** 媒体处理结果 */
export interface MediaResult {
  /** 媒体类型 */
  type: "pdf" | "image" | "video";
  /** 保存的文件路径 */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** Content-Type */
  contentType: string;
}

// ── 媒体类型检测 ──────────────────────────────────────

/** 检测是否为 PDF */
export function isPdf(contentType: string): boolean {
  return contentType.includes("application/pdf");
}

/** 检测是否为图片（排除 SVG） */
export function isImage(contentType: string): boolean {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

/** 检测是否为视频 */
export function isVideo(contentType: string): boolean {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return mime.startsWith("video/");
}

// ── 文件扩展名映射 ────────────────────────────────────

function getMediaExtension(contentType: string): string {
  const mime = contentType.split(";")[0].trim().toLowerCase();

  const extensionMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "application/pdf": "pdf",
  };

  return extensionMap[mime] || "bin";
}

// ── 媒体保存 ──────────────────────────────────────────

/**
 * 保存媒体文件到磁盘
 * 本地使用：移除 Magic bytes 验证
 *
 * @param body - 文件内容
 * @param contentType - Content-Type
 * @param sessionFolder - 会话文件夹路径
 * @returns 保存结果
 */
export async function saveMedia(
  body: ArrayBuffer,
  contentType: string,
  sessionFolder: string,
): Promise<MediaResult | null> {
  // 确定媒体类型
  let mediaType: "pdf" | "image" | "video";
  if (isPdf(contentType)) {
    mediaType = "pdf";
  } else if (isImage(contentType)) {
    mediaType = "image";
  } else if (isVideo(contentType)) {
    mediaType = "video";
  } else {
    return null;
  }

  // 创建目录
  const subDir = mediaType === "pdf" ? "downloads" : mediaType === "image" ? "images" : "videos";
  const dirPath = join(sessionFolder, subDir);
  await mkdir(dirPath, { recursive: true });

  // 生成文件名
  const ext = getMediaExtension(contentType);
  const timestamp = Date.now();
  const filename = `${timestamp}.${ext}`;
  const filePath = join(dirPath, filename);

  // 保存文件
  const uint8Array = new Uint8Array(body);
  await writeFile(filePath, uint8Array);
  logger.info(`${mediaType} 已保存: ${filePath} (${body.byteLength} 字节)`);

  return {
    type: mediaType,
    path: filePath,
    size: body.byteLength,
    contentType,
  };
}
