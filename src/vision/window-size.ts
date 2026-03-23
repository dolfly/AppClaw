/**
 * Resolve logical screen size for Stark coordinate scaling (matches hub: /window/rect).
 */

import type { MCPClient, MCPToolResult } from "../mcp/types.js";
import { pngDimensionsFromBase64 } from "./png-dimensions.js";

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
 * Best-effort window size from appium-mcp; falls back to PNG screenshot dimensions.
 */
export async function getScreenSizeForStark(
  mcp: MCPClient,
  screenshotBase64: string
): Promise<{ width: number; height: number }> {
  const toolAttempts = [
    "appium_get_window_rect",
    "appium_get_window_size",
    "get_window_rect",
  ] as const;

  for (const name of toolAttempts) {
    try {
      const result = await mcp.callTool(name, {});
      const text = mcpResultText(result);
      const parsed = tryParseSizeFromText(text);
      if (parsed) return parsed;
    } catch {
      /* tool missing */
    }
  }

  try {
    const result = await mcp.callTool("appium_execute_script", {
      script: "mobile: deviceScreenSize",
      args: [],
    });
    const text = mcpResultText(result);
    const parsed = tryParseSizeFromText(text);
    if (parsed) return parsed;
  } catch {
    /* unsupported */
  }

  const fromPng = pngDimensionsFromBase64(screenshotBase64);
  if (fromPng) return fromPng;

  throw new Error(
    "Could not determine screen size for Stark (no window rect tool and screenshot is not a PNG). " +
      "Ensure appium-mcp exposes window size or screenshots are PNG."
  );
}
