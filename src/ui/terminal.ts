/**
 * Terminal UI — styled console output for AppClaw.
 *
 * Centralizes all terminal formatting: colors, box drawing,
 * spinners, and structured output.
 */

import chalk from "chalk";

import { Config } from "../config.js";

// ─── Theme colors ─────────────────────────────────────────

const theme = {
  brand:    chalk.hex("#7C6FFF"),      // purple accent
  success:  chalk.green,
  error:    chalk.red,
  warn:     chalk.yellow,
  dim:      chalk.dim,
  bold:     chalk.bold,
  muted:    chalk.gray,
  info:     chalk.cyan,
  white:    chalk.white,
  step:     chalk.hex("#6CB6FF"),       // light blue
  label:    chalk.hex("#9CA3AF"),       // gray label
};

// ─── Box drawing ──────────────────────────────────────────

const BOX = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
  rule: "─",
};

function hr(label?: string, width = 50): string {
  if (!label) return theme.dim(BOX.rule.repeat(width));
  const pad = width - label.length - 4;
  const right = Math.max(pad, 2);
  return theme.dim(`${BOX.rule.repeat(2)} `) + theme.brand.bold(label) + theme.dim(` ${BOX.rule.repeat(right)}`);
}

/** Strip ANSI escape codes to get visible string length */
function visLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, "").length;
}

// ─── Spinner (Claude Code–style: bold phrase + dim parenthetical) ──

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
/** True after startSpinner writes a line until stopSpinner clears it (safe double-stop). */
let spinnerLineActive = false;
let spinnerPrimary = "";
let spinnerDetail: string | undefined;

function paintSpinnerLine(frame: number, leadingCr: boolean): void {
  const sym = theme.brand(SPINNER_FRAMES[frame]);
  const line = spinnerDetail
    ? `  ${sym} ${theme.step.bold(spinnerPrimary)} ${theme.dim(`(${spinnerDetail})`)}`
    : `  ${sym} ${theme.dim(spinnerPrimary)}`;
  const pad = Math.max(0, 100 - visLen(line));
  process.stdout.write(`${leadingCr ? "\r" : ""}${line}${" ".repeat(pad)}`);
}

/**
 * Dim context shown after the agent spinner phrase: mode, thinking, model.
 */
export function formatAgentThinkingDetail(modelName: string): string {
  const mode = Config.AGENT_MODE === "vision" ? "vision" : "dom";
  const think = Config.LLM_THINKING === "on" ? "thinking on" : "thinking off";
  const m = modelName.trim() || "model";
  const short = m.length > 40 ? `${m.slice(0, 37)}…` : m;
  return `${mode} · ${think} · ${short}`;
}

/** Static status line before a spinner (hollow bullet + dim text). */
export function printAgentBullet(message: string): void {
  console.log(`  ${theme.muted("○")} ${theme.dim(message)}`);
}

/**
 * @param message Short verb phrase (emphasized when `detail` is set).
 * @param detail Optional dim parenthetical, e.g. from `formatAgentThinkingDetail`.
 */
export function startSpinner(message: string, detail?: string): void {
  stopSpinner();
  spinnerFrame = 0;
  spinnerLineActive = true;
  spinnerPrimary = message;
  spinnerDetail = detail;
  paintSpinnerLine(0, false);
  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    paintSpinnerLine(spinnerFrame, true);
  }, 80);
}

export function stopSpinner(finalMessage?: string): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  if (spinnerLineActive) {
    spinnerLineActive = false;
    process.stdout.write("\r" + " ".repeat(100) + "\r");
    if (finalMessage) {
      process.stdout.write(finalMessage + "\n");
    }
  }
}

// ─── Header ───────────────────────────────────────────────

const LOGO_LINES = [
  "▄▀█ █▀█ █▀█ █▀▀ █   ▄▀█ █ █ █",
  "█▀█ █▀▀ █▀▀ █▄▄ █▄▄ █▀█ ▀▄▀▄▀",
];

const W = 56; // inner visible width

/** Box line: pads content to W visible chars, wraps with │ */
function bx(content: string, visibleLen: number): string {
  const pad = W - visibleLen;
  return `  ${theme.dim(BOX.v)} ${content}${" ".repeat(Math.max(pad, 0))}${theme.dim(BOX.v)}`;
}

function boxTop(label?: string): string {
  if (label) {
    // ╭─ Label ──...──╮
    const inner = W - label.length - 2; // -2 for spaces around label
    return `  ${theme.dim(`${BOX.tl}${BOX.h}`)} ${theme.brand.bold(label)} ${theme.dim(BOX.h.repeat(Math.max(inner, 2)) + BOX.tr)}`;
  }
  return `  ${theme.dim(BOX.tl + BOX.h.repeat(W + 2) + BOX.tr)}`;
}

function boxBottom(): string {
  return `  ${theme.dim(BOX.bl + BOX.h.repeat(W + 2) + BOX.br)}`;
}

function boxDivider(): string {
  return `  ${theme.dim("├" + BOX.h.repeat(W + 2) + "┤")}`;
}

function boxEmpty(): string {
  return bx("", 0);
}

/** Build a box line from a pre-styled string, auto-measuring visible width */
function bxAuto(styled: string): string {
  const len = visLen(styled);
  const pad = W - len;
  return `  ${theme.dim(BOX.v)} ${styled}${" ".repeat(Math.max(pad, 0))}${theme.dim(BOX.v)}`;
}

export function printHeader(version: string = "0.1.0"): void {
  const vTag = `v${version}`;
  console.log();
  console.log(boxTop("AppClaw"));
  console.log(boxEmpty());
  for (const line of LOGO_LINES) {
    console.log(bxAuto(`   ${theme.brand(line)}`));
  }
  // Version right-aligned with 1-char gap from border
  const vPad = W - vTag.length - 1;
  console.log(bxAuto(`${" ".repeat(vPad)}${theme.dim(vTag)} `));
  console.log(boxEmpty());
  console.log(bxAuto(`   ${theme.muted("AI Mobile Testing Agent")}`));
  console.log(boxEmpty());
  console.log(boxBottom());
  console.log();
}

export function printInteractiveHeader(): void {
  console.log();
  console.log(boxTop("AppClaw"));
  console.log(boxEmpty());
  for (const line of LOGO_LINES) {
    console.log(bxAuto(`   ${theme.brand(line)}`));
  }
  console.log(boxEmpty());
  console.log(bxAuto(`   ${theme.muted("AI Mobile Testing Agent")}`));
  console.log(boxEmpty());
  console.log(boxDivider());
  console.log(boxEmpty());
  console.log(bxAuto(`   ${theme.info("--record")}   ${theme.muted("Record actions for replay")}`));
  console.log(bxAuto(`   ${theme.info("--replay")}   ${theme.muted("Replay a recorded flow")}`));
  console.log(bxAuto(`   ${theme.info("--flow")}     ${theme.muted("Run steps from a YAML file (no LLM)")}`));
  console.log(bxAuto(`   ${theme.info("--plan")}     ${theme.muted("Decompose complex goals")}`));
  console.log(boxEmpty());
  console.log(boxBottom());
  console.log();
}

// ─── Setup / Config ───────────────────────────────────────

export function printConfig(entries: Array<[string, string]>): void {
  for (const [label, value] of entries) {
    const paddedLabel = label.padEnd(12);
    console.log(`  ${theme.label(paddedLabel)} ${theme.white(value)}`);
  }
}

export function printSetupOk(message: string): void {
  console.log(`  ${theme.success("✓")} ${message}`);
}

export function printSetupError(message: string, hint?: string): void {
  console.log(`  ${theme.error("✗")} ${message}`);
  if (hint) {
    console.log(`    ${theme.dim(hint)}`);
  }
}

// ─── Goal / Agent ─────────────────────────────────────────

export function printGoalStart(goal: string, maxSteps: number): void {
  console.log();
  console.log(`  ${hr("Goal")}`);
  console.log(`  ${theme.bold(goal)}`);
  console.log(`  ${theme.dim(`Max ${maxSteps} steps`)}`);
  console.log();
}

export function printStep(
  step: number,
  maxSteps: number,
  toolName: string,
  argsSummary: string
): void {
  const stepNum = theme.dim(`${step}/${maxSteps}`);
  const tool = theme.step(toolName);
  const args = argsSummary ? theme.muted(argsSummary) : "";
  console.log(`  ${stepNum}  ${tool}${args}`);
}

export function printStepDetail(message: string): void {
  console.log(`        ${theme.dim("→")} ${theme.dim(message)}`);
}

export function printStepError(message: string): void {
  console.log(`        ${theme.error("✗")} ${theme.error(message)}`);
}

export function printGoalSuccess(steps: number, reason: string): void {
  console.log();
  console.log(`  ${theme.success("✓")} ${theme.success.bold("Completed")} ${theme.dim(`in ${steps} steps`)}`);
  console.log(`    ${theme.dim(reason)}`);
}

export function printGoalFailed(reason: string): void {
  console.log();
  console.log(`  ${theme.error("✗")} ${theme.error.bold("Failed")} ${theme.dim("—")} ${theme.dim(reason)}`);
}

// ─── Plan mode ────────────────────────────────────────────

export function printPlanStart(): void {
  startSpinner("Decomposing your goal…", "planner");
}

export function printPlan(subGoals: Array<{ goal: string }>, reasoning: string): void {
  console.log();
  console.log(`  ${hr("Plan")}`);
  console.log();
  for (let i = 0; i < subGoals.length; i++) {
    console.log(`  ${theme.dim(`${i + 1}.`)} ${subGoals[i].goal}`);
  }
  console.log();
  console.log(`  ${theme.dim(reasoning)}`);
  console.log();
}

export function printSubGoalHeader(
  index: number,
  total: number,
  goal: string,
  allGoals: Array<{ goal: string; status: string }>
): void {
  console.log();
  console.log(`  ${hr(`${index + 1}/${total}: ${goal}`)}`);
  // Show plan progress: completed, current, upcoming
  if (allGoals.length > 1) {
    console.log();
    for (let i = 0; i < allGoals.length; i++) {
      const sg = allGoals[i];
      if (sg.status === "completed") {
        console.log(`  ${theme.success("✓")} ${theme.dim(`${i + 1}. ${sg.goal}`)}`);
      } else if (i === index) {
        console.log(`  ${theme.brand("▸")} ${theme.white.bold(`${i + 1}. ${sg.goal}`)}`);
      } else {
        console.log(`  ${theme.dim("○")} ${theme.dim(`${i + 1}. ${sg.goal}`)}`);
      }
    }
  }
}

export function printPlanSummary(
  subGoals: Array<{ goal: string; status: string; result?: string }>
): void {
  console.log();
  console.log(`  ${hr("Summary")}`);
  console.log();
  for (let i = 0; i < subGoals.length; i++) {
    const sg = subGoals[i];
    const icon = sg.status === "completed" ? theme.success("✓") : theme.error("✗");
    const text = sg.status === "completed" ? theme.white(sg.goal) : theme.dim(sg.goal);
    console.log(`  ${icon} ${theme.dim(`${i + 1}.`)} ${text}`);
    if (sg.result) {
      console.log(`       ${theme.dim(sg.result)}`);
    }
  }
  console.log();
}

// ─── Plan context ─────────────────────────────────────────

export function printPlanContext(
  overallGoal: string,
  _currentGoal: string,
  allGoals: Array<{ goal: string; status: string; result?: string }>,
  currentIndex: number
): void {
  console.log();
  console.log(`  ${hr("Plan Context")}`);
  console.log();

  // Overall goal — word-wrap if long
  const goalPrefix = theme.label("Goal: ");
  const maxGoalLen = 60;
  if (overallGoal.length > maxGoalLen) {
    const words = overallGoal.split(" ");
    let line = "";
    let first = true;
    for (const word of words) {
      if (line.length + word.length + 1 > maxGoalLen) {
        console.log(`  ${first ? goalPrefix : "        "}${theme.white(line)}`);
        line = word;
        first = false;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) console.log(`  ${first ? goalPrefix : "        "}${theme.white(line)}`);
  } else {
    console.log(`  ${goalPrefix}${theme.white(overallGoal)}`);
  }

  console.log();

  // Sub-goals with status
  for (let i = 0; i < allGoals.length; i++) {
    const sg = allGoals[i];
    const num = theme.dim(`${i + 1}.`);

    if (sg.status === "completed") {
      console.log(`  ${theme.success("✓")} ${num} ${theme.dim(sg.goal)}`);
    } else if (i === currentIndex) {
      console.log(`  ${theme.brand("▸")} ${num} ${theme.white.bold(sg.goal)}`);
    } else {
      console.log(`  ${theme.dim("○")} ${num} ${theme.dim(sg.goal)}`);
    }
  }

  console.log();
}

// ─── Replay mode ──────────────────────────────────────────

export function printReplayHeader(filepath: string): void {
  console.log();
  console.log(`  ${hr("Replay")}`);
  console.log(`  ${theme.dim(filepath)}`);
}

export function printReplayGoal(goal: string, totalSteps: number): void {
  console.log(`  ${theme.bold(goal)} ${theme.dim(`(${totalSteps} steps)`)}`);
  console.log();
}

export function printReplayStep(
  step: number,
  total: number,
  toolName: string,
  adapted: boolean,
  success: boolean
): void {
  const stepNum = theme.dim(`${step}/${total}`);
  const tool = theme.step(toolName);
  const badge = adapted ? theme.info(" adapted") : "";
  const status = success ? theme.success(" ok") : theme.error(" failed");
  console.log(`  ${stepNum}  ${tool}${badge}${status}`);
}

export function printYamlFlowHeader(filepath: string): void {
  console.log();
  console.log(`  ${hr("YAML flow")}`);
  console.log(`  ${theme.dim(filepath)}`);
}

export function printFlowStep(step: number, total: number, label: string, success: boolean): void {
  const stepNum = theme.dim(`${step}/${total}`);
  const line = theme.step(label);
  const status = success ? theme.success(" ok") : theme.error(" failed");
  console.log(`  ${stepNum}  ${line}${status}`);
}

export function printReplayResult(
  passed: number,
  total: number,
  adapted: number
): void {
  const allPassed = passed === total;
  console.log();
  const icon = allPassed ? theme.success("✓") : theme.warn("!");
  const status = allPassed
    ? theme.success.bold("All steps passed")
    : theme.warn.bold(`${passed}/${total} passed`);
  const adaptedNote = adapted > 0 ? theme.dim(`, ${adapted} adapted`) : "";
  console.log(`  ${icon} ${status}${adaptedNote}`);
  console.log();
}

// ─── Status / misc ────────────────────────────────────────

export function printWarning(message: string): void {
  console.log(`  ${theme.warn("!")} ${theme.warn(message)}`);
}

export function printInfo(message: string): void {
  console.log(`  ${theme.info("ℹ")} ${theme.dim(message)}`);
}

export function printOrchestratorSkip(subGoal: string, reason: string): void {
  console.log(`  ${theme.success("⏭")} ${theme.success("SKIP")} ${theme.white(subGoal)}`);
  console.log(`    ${theme.dim(reason)}`);
}

export function printOrchestratorRewrite(original: string, rewritten: string): void {
  console.log(`  ${theme.warn("✎")} ${theme.warn("ADAPT")} ${theme.dim(original)}`);
  console.log(`    ${theme.brand("→")} ${theme.white.bold(rewritten)}`);
}

export function printOrchestratorProceed(subGoal: string): void {
  console.log(`  ${theme.step("▶")} ${theme.step("PROCEED")} ${theme.white(subGoal)}`);
}

export function printScreenReadiness(issues: string[], suggestedAction?: string): void {
  console.log(`  ${theme.warn("⚠")} ${theme.warn("SCREEN NOT READY")} — issues detected:`);
  for (const issue of issues) {
    console.log(`    ${theme.dim("•")} ${theme.dim(issue)}`);
  }
  if (suggestedAction) {
    console.log(`    ${theme.brand("→")} ${theme.white(suggestedAction)}`);
  }
}

export function printError(message: string, detail?: string): void {
  console.log(`  ${theme.error("✗")} ${message}`);
  if (detail) {
    console.log(`    ${theme.dim(detail)}`);
  }
}

export function printFileSaved(label: string, filepath: string): void {
  console.log(`  ${theme.dim(label)} ${theme.muted(filepath)}`);
}

export function printStuck(step: number): void {
  console.log(`  ${theme.warn("!")} ${theme.warn("Stuck detected")} ${theme.dim(`at step ${step}`)}`);
}

export function printRecovery(message: string): void {
  console.log(`  ${theme.info("↻")} ${theme.dim(message)}`);
}

export function printPreprocessor(message: string): void {
  printStepDetail(message);
}

// ─── HITL ─────────────────────────────────────────────────

export function formatHITLPrompt(type: string, question: string, options?: string[]): string {
  let prompt = `\n  ${theme.info("?")} ${theme.info(`[${type.toUpperCase()}]`)} ${question}`;
  if (options && options.length > 0) {
    for (let i = 0; i < options.length; i++) {
      prompt += `\n     ${theme.dim(`${i + 1}.`)} ${options[i]}`;
    }
  }
  prompt += `\n  ${theme.brand(">")} `;
  return prompt;
}

export function printTimeout(): void {
  console.log(`  ${theme.dim("Timed out waiting for input")}`);
}

// ─── Token usage ─────────────────────────────────────────

export function printStepTokens(inputTokens: number, outputTokens: number): void {
  if (!Config.SHOW_TOKEN_USAGE) return;
  const total = inputTokens + outputTokens;
  console.log(
    `        ${theme.dim("⟠")} ${theme.dim(`tokens: ${total}`)} ${theme.dim(`(in: ${inputTokens}, out: ${outputTokens})`)}`
  );
}

export function printTokenSummary(
  totalInput: number,
  totalOutput: number,
  cost: number,
  modelName: string
): void {
  if (!Config.SHOW_TOKEN_USAGE) return;
  const totalTokens = totalInput + totalOutput;
  console.log();
  console.log(`  ${hr("Token Usage")}`);
  console.log(`  ${theme.label("Model:")}        ${theme.white(modelName)}`);
  console.log(`  ${theme.label("Input:")}        ${theme.white(totalInput.toLocaleString())} tokens`);
  console.log(`  ${theme.label("Output:")}       ${theme.white(totalOutput.toLocaleString())} tokens`);
  console.log(`  ${theme.label("Total:")}        ${theme.white(totalTokens.toLocaleString())} tokens`);
  console.log(`  ${theme.label("Est. cost:")}    ${theme.success(`$${cost.toFixed(6)}`)}`);
}

// Re-export theme for ad-hoc use
export { theme };
