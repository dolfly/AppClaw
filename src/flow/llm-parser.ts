/**
 * LLM-based instruction classifier — replaces regex parsing in natural-line.ts.
 *
 * Sends the user's natural language instruction to the configured LLM
 * and gets back a structured FlowStep classification.
 */

import { generateText } from "ai";
import { buildModel } from "../llm/provider.js";
import { loadConfig, type AppClawConfig } from "../config.js";
import type { FlowStep } from "./types.js";

const CLASSIFICATION_PROMPT = `You are a mobile test instruction classifier. Given a user instruction, classify it into exactly one step type and return the result as a JSON object.

Available step types:
1. openApp — open/launch/start an app → { "kind": "openApp", "query": "<app name>" }
2. tap — tap/click/select/choose/press/toggle/navigate to/close/dismiss an element → { "kind": "tap", "label": "<element description>" }
3. type — type/enter/input text, search for something → { "kind": "type", "text": "<text to type>", "target": "<optional field name or omit>" }
4. enter — press enter/return/submit/confirm/perform search → { "kind": "enter" }
5. back — go back/navigate back/press back → { "kind": "back" }
6. home — go home/press home → { "kind": "home" }
7. swipe — swipe/scroll in a direction → { "kind": "swipe", "direction": "up|down|left|right" }
8. wait — wait/pause/sleep → { "kind": "wait", "seconds": <number, default 2> }
9. assert — verify/check/assert something is visible/present → { "kind": "assert", "text": "<text to verify>" }
10. scrollAssert — scroll until something is visible → { "kind": "scrollAssert", "text": "<text>", "direction": "down", "maxScrolls": 3 }
11. getInfo — ask a question about what's on screen (colors, state, count, describe, what text, is X yellow, tell me, what's in, show me, how many, list) → { "kind": "getInfo", "query": "<the full question>" }
12. done — mark flow as complete → { "kind": "done", "message": "<optional message or omit>" }

Rules:
- Return ONLY a valid JSON object. No markdown fences, no explanation.
- If the instruction is a question about what's visible on screen, use getInfo.
- "search for X" means type X into a search field → kind: type.
- "navigate to X" means tap on X → kind: tap.
- For type with "X in Y", set text=X and target=Y.
- Default wait seconds = 2 if not specified.
- Default scrollAssert direction = "down", maxScrolls = 3.
- For done without a message, omit the message field.`;

let cachedModel: ReturnType<typeof buildModel> | null = null;
let cachedConfig: AppClawConfig | null = null;

function getModel() {
  if (!cachedModel) {
    cachedConfig = loadConfig();
    cachedModel = buildModel(cachedConfig);
  }
  return cachedModel;
}

/**
 * Classify a natural language instruction into a FlowStep using the LLM.
 * Returns the classified step with `verbatim` set to the original instruction.
 */
const mcpDebug = process.env.MCP_DEBUG === "1" || process.env.MCP_DEBUG === "true";

export async function classifyInstruction(instruction: string): Promise<FlowStep> {
  const model = getModel();

  const t0 = performance.now();
  const result = await generateText({
    model: model as any,
    system: CLASSIFICATION_PROMPT,
    messages: [{ role: "user", content: instruction }],
    temperature: 0,
    maxOutputTokens: 256,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
      anthropic: { thinking: { type: "disabled" } },
    },
  });
  if (mcpDebug) {
    const elapsed = Math.round(performance.now() - t0);
    console.log(`        classifyInstruction ${elapsed}ms`);
  }

  const text = result.text
    .replace(/(^```json\s*|```\s*$)/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`LLM returned invalid JSON for instruction "${instruction}": ${text}`);
  }

  // Validate kind
  const validKinds = [
    "openApp", "tap", "type", "enter", "back", "home",
    "swipe", "wait", "assert", "scrollAssert", "getInfo", "done",
  ];
  if (!validKinds.includes(parsed.kind)) {
    throw new Error(`LLM returned unknown step kind "${parsed.kind}" for instruction "${instruction}"`);
  }

  // Attach verbatim
  parsed.verbatim = instruction;

  return parsed as FlowStep;
}
