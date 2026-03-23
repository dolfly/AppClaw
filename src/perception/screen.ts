/**
 * Unified screen perception — calls appium_get_page_source via MCP,
 * detects platform, parses XML, filters elements.
 */

import type { MCPClient } from "../mcp/types.js";
import { getPageSource, screenshot } from "../mcp/tools.js";
import type { ScreenState } from "./types.js";
import { parseAndroidPageSource } from "./android-parser.js";
import { parseIOSPageSource } from "./ios-parser.js";
import { filterElements } from "./element-filter.js";
import { trimDOM } from "./dom-trimmer.js";

/** Detect platform from page source XML content. */
export function detectPlatform(pageSource: string): "android" | "ios" {
  if (pageSource.includes("XCUIElementType")) return "ios";
  return "android";
}

/** Get the full screen state from the device via MCP tools. */
export async function getScreenState(
  mcp: MCPClient,
  maxElements: number,
  captureScreenshot: boolean = false,
  /** Skip page source fetch — for vision mode where DOM is not needed */
  skipPageSource: boolean = false
): Promise<ScreenState> {
  let raw = "";
  let elements: import("./types.js").UIElement[] = [];
  let filtered: import("./types.js").CompactUIElement[] = [];
  let dom = "";
  let platform: "android" | "ios" = "android";

  if (!skipPageSource) {
    raw = await getPageSource(mcp);
    platform = detectPlatform(raw);

    elements = platform === "android"
      ? parseAndroidPageSource(raw)
      : parseIOSPageSource(raw);

    filtered = filterElements(elements, maxElements);
    dom = trimDOM(raw, platform, maxElements);
  }

  let screenshotData: string | undefined;
  if (captureScreenshot) {
    try {
      const result = await screenshot(mcp);
      screenshotData = result ?? undefined;
    } catch {
      // Screenshot may fail on secure screens
    }
  }

  return { elements, filtered, dom, screenshot: screenshotData, platform, raw };
}
