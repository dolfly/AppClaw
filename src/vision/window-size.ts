/**
 * Resolve physical screen size for Stark coordinate scaling.
 *
 * Appium W3C Actions expect physical pixel coordinates, so we must resolve
 * the real device resolution — not dp/logical pixels from scaled MJPEG frames.
 *
 * The authoritative source on Android is `realDisplaySize` from device info
 * (e.g. "720x1600"). This is equivalent to what appium-stark-vision uses
 * via `driver.caps.deviceScreenSize`. We cache it after session creation.
 */

import type { MCPClient, MCPToolResult } from "../mcp/types.js";
import { pngDimensionsFromBase64 } from "./png-dimensions.js";

/** Cached physical screen size set from session capabilities. */
let cachedScreenSize: { width: number; height: number } | null = null;

/**
 * Set the cached screen size from a "WxH" string (e.g. "720x1600").
 * Call after `create_session` so Stark coordinate scaling always uses physical pixels.
 */
export function setDeviceScreenSize(deviceScreenSize: string): void {
  const m = deviceScreenSize.match(/(\d+)\s*x\s*(\d+)/);
  if (m) {
    cachedScreenSize = { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  }
}

function mcpResultText(result: MCPToolResult): string {
  for (const content of result.content) {
    if (content.type === "text") return content.text;
  }
  return "";
}

function tryParseSizeFromText(text: string): { width: number; height: number } | null {
  const trimmed = text.trim();
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const w = Number(obj.width ?? obj.w);
    const h = Number(obj.height ?? obj.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) };
    }
  } catch {
    /* not JSON */
  }
  const m = trimmed.match(/\b(\d{2,5})\s*[x×,]\s*(\d{2,5})\b/);
  if (m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return null;
}

/**
 * Best-effort screen size from appium-mcp for Stark coordinate scaling.
 * Returns physical pixel dimensions suitable for W3C Actions.
 */
export async function getScreenSizeForStark(
  mcp: MCPClient,
  screenshotBase64: string
): Promise<{ width: number; height: number }> {
  // 0. Use cached deviceScreenSize (most reliable — set at session creation)
  if (cachedScreenSize) return cachedScreenSize;

  // 1. Standard window rect tools
  for (const name of ["appium_get_window_rect", "appium_get_window_size", "get_window_rect"] as const) {
    try {
      const result = await mcp.callTool(name, {});
      const parsed = tryParseSizeFromText(mcpResultText(result));
      if (parsed) return parsed;
    } catch { /* tool missing */ }
  }

  // 2. appium_mobile_get_device_info — returns realDisplaySize in physical pixels
  try {
    const result = await mcp.callTool("appium_mobile_get_device_info", {});
    const text = mcpResultText(result);
    const sizeMatch = text.match(/realDisplaySize['":\s]+(\d+)x(\d+)/i);
    if (sizeMatch) {
      const size = { width: parseInt(sizeMatch[1], 10), height: parseInt(sizeMatch[2], 10) };
      cachedScreenSize = size;
      return size;
    }
  } catch { /* tool missing */ }

  // 3. Screenshot dimensions (last resort — may be dp with MJPEG)
  const fromImage = pngDimensionsFromBase64(screenshotBase64);
  if (fromImage) return fromImage;

  throw new Error(
    "Could not determine screen size for Stark. " +
      "Ensure appium-mcp exposes device info or window size tools."
  );
}
