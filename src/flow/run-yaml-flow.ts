/**
 * Execute a declarative YAML flow (structured and/or natural-language steps).
 * No LLM — DOM text matching, optional vision fallback when enabled.
 */

import type { MCPClient } from "../mcp/types.js";
import { getPageSource } from "../mcp/tools.js";
import { activateAppWithFallback } from "../mcp/activate-app.js";
import { detectDeviceUdid, typeViaKeyboard } from "../mcp/keyboard.js";
import { detectPlatform } from "../perception/screen.js";
import { parseAndroidPageSource } from "../perception/android-parser.js";
import { parseIOSPageSource } from "../perception/ios-parser.js";
import type { UIElement } from "../perception/types.js";
import {
  findByIdStrategies,
  findByVision,
  isAIElement,
  parseAIElementCoords,
  tapAtCoordinates,
} from "../agent/element-finder.js";
import { isVisionLocateEnabled } from "../vision/locate-enabled.js";
import type { ActionResult } from "../llm/schemas.js";
import type { FlowMeta, FlowStep } from "./types.js";
import type { AppResolver } from "../agent/app-resolver.js";
import { resolveAppId } from "../agent/preprocessor.js";
import * as ui from "../ui/terminal.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface RunYamlFlowOptions {
  stepDelayMs?: number;
  /** Required for natural-language `open … app` steps */
  appResolver?: AppResolver;
  /**
   * When tapping by label, re-read the hierarchy this many times until a match appears
   * (covers navigation / animation). Default 20 × 300ms ≈ 6s max wait before vision / failure.
   */
  tapTargetMaxAttempts?: number;
  tapTargetPollIntervalMs?: number;
}

const DEFAULT_TAP_MAX_ATTEMPTS = 20;
const DEFAULT_TAP_POLL_MS = 300;

export interface FlowTapPollOptions {
  maxAttempts: number;
  intervalMs: number;
}

export interface RunYamlFlowResult {
  success: boolean;
  stepsExecuted: number;
  stepsTotal: number;
  failedAt?: number;
  reason?: string;
}

function stepLabel(step: FlowStep): string {
  if (step.verbatim) return step.verbatim;
  switch (step.kind) {
    case "launchApp":
      return "launchApp";
    case "openApp":
      return `open "${step.query}"`;
    case "wait":
      return `wait ${step.seconds}s`;
    case "tap":
      return `tap "${step.label}"`;
    case "type":
      return `type "${step.text.length > 40 ? `${step.text.slice(0, 37)}…` : step.text}"`;
    case "enter":
      return "enter";
    case "back":
      return "goBack";
    case "home":
      return "goHome";
    case "swipe":
      return `swipe ${step.direction}`;
    case "done":
      return step.message ? `done (${step.message})` : "done";
  }
}

function scoreTapMatch(el: UIElement, needle: string): number {
  if (el.enabled === false) return -1;
  const n = needle.toLowerCase();
  const text = el.text.toLowerCase();
  const hint = (el.hint ?? "").toLowerCase();
  const aid = el.accessibilityId.toLowerCase();
  const id = el.id.toLowerCase();

  const fields = [text, hint, aid, id];
  for (const f of fields) {
    if (f === n) return 0;
  }
  for (const f of fields) {
    if (f.includes(n)) return 1;
  }
  return -1;
}

/** One DOM snapshot: find label and click. Returns null if no match / no UUID (caller may retry). */
async function tryTapByLabelOnDom(mcp: MCPClient, label: string): Promise<ActionResult | null> {
  const pageSource = await getPageSource(mcp);
  const platform = detectPlatform(pageSource);
  const elements =
    platform === "android" ? parseAndroidPageSource(pageSource) : parseIOSPageSource(pageSource);

  const scored = elements
    .map(el => ({ el, s: scoreTapMatch(el, label) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => {
      if (a.s !== b.s) return a.s - b.s;
      if (a.el.clickable !== b.el.clickable) return a.el.clickable ? -1 : 1;
      return 0;
    });

  const pick = scored[0]?.el;
  if (!pick) return null;

  const uuid = await findByIdStrategies(mcp, pick.accessibilityId || pick.id, pick.text);
  if (!uuid) return null;

  await mcp.callTool("appium_click", { elementUUID: uuid });
  return { success: true, message: `Tapped "${label}"` };
}

async function tapByLabel(
  mcp: MCPClient,
  label: string,
  poll: FlowTapPollOptions
): Promise<ActionResult> {
  for (let attempt = 0; attempt < poll.maxAttempts; attempt++) {
    const domTap = await tryTapByLabelOnDom(mcp, label);
    if (domTap) return domTap;
    if (attempt + 1 < poll.maxAttempts) {
      await sleep(poll.intervalMs);
    }
  }

  if (isVisionLocateEnabled()) {
    const uuid = await findByVision(mcp, `UI element labeled or showing "${label}"`);
    if (uuid) {
      if (isAIElement(uuid)) {
        const coords = parseAIElementCoords(uuid);
        if (coords) {
          const tapped = await tapAtCoordinates(mcp, coords.x, coords.y);
          if (tapped) {
            return {
              success: true,
              message: `Tapped "${label}" via vision at [${coords.x}, ${coords.y}]`,
            };
          }
        }
      } else {
        await mcp.callTool("appium_click", { elementUUID: uuid });
        return { success: true, message: `Tapped "${label}" via vision` };
      }
    }
  }

  return { success: false, message: `No matching element for "${label}"` };
}

async function flowTypeText(mcp: MCPClient, text: string): Promise<ActionResult> {
  const pageSource = await getPageSource(mcp);
  const platform = detectPlatform(pageSource);

  if (platform === "android") {
    const udid = await detectDeviceUdid();
    const kb = await typeViaKeyboard(text, udid ?? undefined);
    if (kb.success) {
      return { success: true, message: kb.message };
    }
  }

  const elements =
    platform === "android" ? parseAndroidPageSource(pageSource) : parseIOSPageSource(pageSource);
  const editable = elements.find(e => e.editable && e.enabled !== false);
  if (!editable) {
    return { success: false, message: "No editable field found for type" };
  }
  const uuid = await findByIdStrategies(mcp, editable.accessibilityId || editable.id, editable.text);
  if (!uuid) {
    return { success: false, message: "Could not resolve editable element" };
  }
  await mcp.callTool("appium_click", { elementUUID: uuid });
  await mcp.callTool("appium_clear_element", { elementUUID: uuid }).catch(() => {});
  const setResult = await mcp.callTool("appium_set_value", { elementUUID: uuid, text });
  const setText =
    setResult.content?.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : "")).join("") ??
    "";
  if (setText.toLowerCase().includes("error") || setText.toLowerCase().includes("failed")) {
    return { success: false, message: setText.slice(0, 200) };
  }
  return { success: true, message: `Typed "${text}"` };
}

async function executeStep(
  mcp: MCPClient,
  step: FlowStep,
  meta: FlowMeta,
  appResolver: AppResolver | undefined,
  tapPoll: FlowTapPollOptions
): Promise<ActionResult> {
  switch (step.kind) {
    case "launchApp": {
      const id = meta.appId?.trim();
      if (!id) {
        return { success: false, message: "launchApp requires appId in the YAML header" };
      }
      const r = await activateAppWithFallback(mcp, id);
      return { success: r.success, message: r.message };
    }
    case "openApp": {
      if (!appResolver) {
        return {
          success: false,
          message: "open … app steps need the installed-apps list (internal: pass AppResolver)",
        };
      }
      const pkg = resolveAppId(step.query, appResolver);
      if (!pkg) {
        return {
          success: false,
          message: `Could not resolve app name "${step.query}" to a package (install it or add appId in YAML header + use launchApp)`,
        };
      }
      const r = await activateAppWithFallback(mcp, pkg);
      return { success: r.success, message: r.success ? `Launched ${step.query} (${pkg})` : r.message };
    }
    case "wait":
      await sleep(Math.round(step.seconds * 1000));
      return { success: true, message: `Waited ${step.seconds}s` };
    case "tap":
      return tapByLabel(mcp, step.label, tapPoll);
    case "type":
      return flowTypeText(mcp, step.text);
    case "enter":
      await mcp.callTool("appium_mobile_press_key", { key: "Enter" });
      return { success: true, message: "Enter" };
    case "back":
      await mcp.callTool("appium_mobile_press_key", { key: "BACK" });
      return { success: true, message: "Back" };
    case "home":
      await mcp.callTool("appium_mobile_press_key", { key: "HOME" });
      return { success: true, message: "Home" };
    case "swipe": {
      const result = await mcp.callTool("appium_scroll", { direction: step.direction });
      const text =
        result.content?.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : "")).join("") ??
        "";
      const bad = text.toLowerCase().includes("error") || text.toLowerCase().includes("failed");
      return {
        success: !bad,
        message: bad ? text.slice(0, 200) : `Swiped ${step.direction}`,
      };
    }
    case "done":
      return { success: true, message: step.message ?? "done" };
  }
}

export async function runYamlFlow(
  mcp: MCPClient,
  meta: FlowMeta,
  steps: FlowStep[],
  options: RunYamlFlowOptions = {}
): Promise<RunYamlFlowResult> {
  const stepDelayMs = options.stepDelayMs ?? 500;
  const appResolver = options.appResolver;
  const tapPoll: FlowTapPollOptions = {
    maxAttempts: options.tapTargetMaxAttempts ?? DEFAULT_TAP_MAX_ATTEMPTS,
    intervalMs: options.tapTargetPollIntervalMs ?? DEFAULT_TAP_POLL_MS,
  };
  const title = meta.name?.trim() || meta.appId || "YAML flow";
  const doneSteps = steps.filter(s => s.kind === "done");
  const total = steps.length;

  ui.printReplayGoal(title, total);

  let executed = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = stepLabel(step);
    const n = i + 1;

    if (step.kind === "done") {
      ui.printFlowStep(n, total, label, true);
      executed++;
      ui.printReplayResult(executed, total, 0);
      return {
        success: true,
        stepsExecuted: executed,
        stepsTotal: total,
        reason: step.message,
      };
    }

    const result = await executeStep(mcp, step, meta, appResolver, tapPoll);
    ui.printFlowStep(n, total, label, result.success);
    executed++;

    if (!result.success) {
      ui.printReplayResult(executed - 1, total, 0);
      ui.printError(`Flow stopped at step ${n}`, result.message);
      return {
        success: false,
        stepsExecuted: executed,
        stepsTotal: total,
        failedAt: n,
        reason: result.message,
      };
    }

    await sleep(stepDelayMs);
  }

  if (doneSteps.length === 0) {
    ui.printWarning("Flow ended without a done: step — treating as success");
  }

  const passed = executed;
  ui.printReplayResult(passed, total, 0);

  return {
    success: true,
    stepsExecuted: executed,
    stepsTotal: total,
  };
}
