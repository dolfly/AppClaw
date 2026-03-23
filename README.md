# AppClaw

AI-powered mobile automation agent for Android and iOS. Tell it what to do in plain English — it figures out what to tap, type, and swipe.

AppClaw is a **pure agentic AI brain** that consumes the [appium-mcp](https://github.com/appium/appium-mcp) server. It doesn't re-implement device interactions — it decides which of appium-mcp's 32 tools to call next, using a custom lightweight perception → reasoning → action loop.

```
You: "Send a WhatsApp message to Mom saying good morning"

AppClaw:
  Step 1/30: launch → "com.whatsapp" (Open WhatsApp)
  Step 2/30: find_and_tap → "Mom" (Find Mom in chat list)
  Step 3/30: type → "search_field" text="Mom" (Search for Mom)
  Step 4/30: tap → "Mom" (Open chat with Mom)
  Step 5/30: type → "message_input" text="good morning" (Type the message)
  Step 6/30: submit_message (Find and tap Send button)
  Step 7/30: done (Message sent successfully)

  ✅ Goal completed in 7 steps

  ── Token Usage ──────────────────────────────────
  Model:        gemini-2.0-flash
  Input:        14,320 tokens
  Output:       1,105 tokens
  Total:        15,425 tokens
  Est. cost:    $0.001874
```

## How It Works

```
┌─────────────────────────────────────────┐
│  AppClaw (TypeScript)                   │
│  ┌───────────────────────────────────┐  │
│  │  Agentic Loop                     │  │
│  │  while(step < max) {              │  │
│  │    perceive → reason → act        │  │
│  │  }                                │  │
│  └─────────┬─────────────┬───────────┘  │
│            │             │              │
│  ┌─────────▼───┐  ┌─────▼──────────┐   │
│  │ LLM Layer   │  │ Perception     │   │
│  │ Claude/GPT/ │  │ Parse XML from │   │
│  │ Gemini/Groq │  │ page source    │   │
│  │ /Ollama     │  │ Android + iOS  │   │
│  └─────────────┘  └────────────────┘   │
│            │                            │
│  ┌─────────▼──────────────────────┐     │
│  │ MCP Client                     │     │
│  │ stdio / SSE transport          │     │
│  └────────────────────────────────┘     │
└────────────┬────────────────────────────┘
             │ MCP Protocol
┌────────────▼────────────────────────────┐
│  appium-mcp (32 tools)                  │
│  tap, type, swipe, screenshot, ...      │
├─────────────────────────────────────────┤
│  Appium → UiAutomator2 / XCUITest      │
└────────────┬────────────────────────────┘
             │
        [ Device ]
```

**Each step:**
1. **Perceive** — calls `appium_get_page_source` via MCP, parses the XML into a structured list of UI elements (buttons, inputs, text, toggles)
2. **Reason** — sends the goal + screen state to an LLM, which returns a JSON action decision (what to tap/type/swipe next)
3. **Act** — executes the action via appium-mcp tools (`appium_click`, `appium_set_value`, `scroll`, etc.)
4. **Repeat** until the goal is done or max steps reached

## Operating modes: DOM vs vision (Appium) vs vision (Stark)

AppClaw can drive the device in three different **interaction styles**. Pick one based on whether you trust the accessibility tree (DOM) or you need **visual** targeting (custom UIs, games, bad content-desc).

### Quick comparison

| Mode | `.env` essentials | What the agent “sees” each step | How `find_and_click` / `find_and_type` resolve targets |
|------|-------------------|----------------------------------|--------------------------------------------------------|
| **1. DOM** | `AGENT_MODE=dom` | **Page source** (trimmed XML) + optional screenshot (see `VISION_MODE`) | **Locators:** `accessibility id`, `id`, bounds. Optional **MCP vision**: `strategy=ai_instruction` only if `AI_VISION_ENABLED=true` and your appium-mcp supports it. |
| **2. Vision + Appium MCP** | `AGENT_MODE=vision`<br>`VISION_LOCATE_PROVIDER=appium_mcp`<br>`AI_VISION_ENABLED=true` (+ your MCP vision API vars) | **Screenshot** to the planner; **page source is skipped** for the main agent loop (faster, truly visual-first). | **NL → MCP:** `appium_find_element` with **`ai_instruction`** on the **appium-mcp** server (remote vision service you configure there). |
| **3. Vision + Stark** | `AGENT_MODE=vision`<br>`VISION_LOCATE_PROVIDER=stark`<br>Plus a **Gemini** key (see below) | Same as row 2: **screenshot-first**, no DOM in the loop. | **NL → in-process:** **df-vision** (Stark) screenshots the device via MCP, calls **Google GenAI** locally, returns coordinates; AppClaw taps via appium-mcp. |

**Planner LLM** (Claude / GPT / Gemini / …) is **separate** from Stark’s Gemini client: you can use any provider for planning while Stark handles only **coordinate** inference.

---

### 1. DOM mode (`AGENT_MODE=dom`) — default

**Best for:** Standard Android/iOS apps with good accessibility (Settings, Chrome, most Material apps).

**Behavior:**

- Every step fetches **UiAutomator2 / XCUITest XML**, trims it, and sends it to the planner.
- The model is instructed to use **`find_and_click` / `find_and_type`** with real strategies (`accessibility id`, `id`, …) and bounds when available.
- Screenshots for the planner follow **`VISION_MODE`**:
  - `always` — always attach an image when the model supports vision.
  - `fallback` — image when useful + model supports vision.
  - `never` — text/XML only.

**Optional MCP vision fallback (still DOM-primary):**

```env
AGENT_MODE=dom
VISION_LOCATE_PROVIDER=appium_mcp
AI_VISION_ENABLED=true
# Plus appium-mcp’s own AI vision config (e.g. API base URL / key / model — see MCP docs)
```

When enabled, the prompt allows `strategy=ai_instruction` if ids fail. If **`VISION_LOCATE_PROVIDER=stark`**, those fallbacks use **Stark**; for **screenshot-first** runs (no XML in the loop), still set **`AGENT_MODE=vision`**.

---

### 2. Vision + Appium MCP (`AGENT_MODE=vision` + `VISION_LOCATE_PROVIDER=appium_mcp`)

**Best for:** You already run **appium-mcp** with a **server-side** vision model (your API keys live in MCP config).

**Behavior:**

- Agent loop **does not** load page source for the planner (vision-first).
- Meta-tools **`find_and_click` / `find_and_type`** force **`ai_instruction`**; the **MCP server** turns the NL string into an element or coordinates.

**Required:**

```env
AGENT_MODE=vision
VISION_LOCATE_PROVIDER=appium_mcp
AI_VISION_ENABLED=true
AI_VISION_API_BASE_URL=...   # as required by your appium-mcp build
AI_VISION_API_KEY=...
AI_VISION_MODEL=...
# Optional: AI_VISION_COORD_TYPE=normalized|absolute
```

Use a **vision-capable** planner model (`LLM_PROVIDER` with multimodal support) so screenshot + goal reasoning work well.

---

### 3. Vision + Stark (`AGENT_MODE=vision` + `VISION_LOCATE_PROVIDER=stark`)

**Best for:** You want **NL → coordinates** inside AppClaw using **df-vision** + **Gemini**, without depending on MCP’s built-in ai_instruction stack.

**Behavior:**

- Same screenshot-first loop as mode 2.
- Each visual locate: screenshot via MCP → **Stark / df-vision** → Gemini → tap coordinates via appium-mcp.

**Keys & model (any one path is enough):**

```env
AGENT_MODE=vision
VISION_LOCATE_PROVIDER=stark

# Prefer explicit Stark key, or shared Gemini env:
STARK_VISION_API_KEY=...
# or
GEMINI_API_KEY=...

# Or: LLM_PROVIDER=gemini + LLM_API_KEY — then Stark reuses that key

# Optional — else falls back to LLM_MODEL (if gemini) or gemini-2.5-flash
STARK_VISION_MODEL=gemini-2.5-flash
```

**Package:** This repo typically links **`df-vision`** from a sibling **`device-farm`** checkout (`file:../device-farm/packages/stark-vision`). Adjust `package.json` if your layout differs.

**Debug:** Set `VISION_LOCATE_LOG=true` (default) to see `[vision-locate] stark-vision | …` vs `mcp vision | …` lines.

---

### `VISION_MODE` vs `AGENT_MODE`

- **`AGENT_MODE`** — **How** taps are resolved (DOM locators vs forced visual NL).
- **`VISION_MODE`** — **When** the planner gets a **screenshot** in addition to text (mostly relevant when DOM is present or for orchestration/planner paths that still use XML).

In **`AGENT_MODE=vision`**, the loop still captures screenshots for the model; DOM is omitted for the main agent perception.

---

### YAML flows (`--flow`)

[`--flow`](./examples/flows/) runs **declarative steps** with **no planner LLM**. Taps use **DOM matching + optional Stark vision** if `VISION_LOCATE_PROVIDER=stark` and keys are set — same env as above.

---

### Troubleshooting

| Symptom | Check |
|--------|--------|
| `Could not resolve app name` in YAML / open steps | Device online; app installed; `appium_list_apps` working. |
| Stark never runs | `VISION_LOCATE_PROVIDER=stark`, `AGENT_MODE=vision`, and a Gemini key path from the Stark section. |
| `ai_instruction` errors | `AI_VISION_ENABLED=true`, MCP server vision URL/key, `AGENT_MODE=vision` + `appium_mcp`. |
| Agent ignores DOM | You set `AGENT_MODE=vision` — switch to `dom` for XML-first. |
| High multimodal cost | `LLM_SCREENSHOT_MAX_EDGE_PX=384` (or `768`); does **not** resize Stark’s internal screenshot for coordinates. |

## Prerequisites

1. **Node.js** 18+ installed
2. **Appium** server running:
   ```bash
   npm install -g appium
   appium
   ```
3. **Appium drivers** installed:
   ```bash
   # Android
   appium driver install uiautomator2

   # iOS
   appium driver install xcuitest
   ```
4. **Device connected** — USB, emulator, or simulator:
   ```bash
   # Android: verify connection
   adb devices

   # iOS: boot a simulator
   xcrun simctl boot "iPhone 15"
   ```
5. **LLM API key** — get one from [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), [Google AI](https://aistudio.google.com/), [Groq](https://console.groq.com/), or run [Ollama](https://ollama.com/) locally

## Installation

```bash
git clone https://github.com/your-org/appclaw.git
cd appclaw
npm install
cp .env.example .env
```

Edit `.env` with your LLM provider and API key:

```env
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...

# Optional: downscale screenshots before sending to the agent/planner LLM (0 = off).
# Lowers multimodal input tokens (e.g. Gemini); does not affect Stark vision coordinates.
# Try 384 for minimum image tokens, or 768 for a balance.
# LLM_SCREENSHOT_MAX_EDGE_PX=768

# Optional: MJPEG (UiAutomator2). Default is normal screenshots (both unset / port 0).
# Port-only — embedded MJPEG server; no auto URL (wrong URL breaks agent vision):
# APPIUM_MJPEG_SERVER_PORT=7810
# URL-only or URL + port — only if you verified the URL from the Appium host:
# APPIUM_MJPEG_SCREENSHOT_URL=http://127.0.0.1:7810
```

**MJPEG:** AppClaw never guesses `appium:mjpegScreenshotUrl`. A bad URL reuses stale MJPEG frames while actions still run, so the agent “sees” the wrong screen. Set **`APPIUM_MJPEG_SCREENSHOT_URL`** only to a URL you have verified (adb reverse, correct path). Optionally set **`APPIUM_MJPEG_SERVER_PORT`** for `appium:mjpegServerPort` alone. Requires **appium-mcp** with passthrough `create_session` capabilities (`z.record`).

## Usage

### Run a goal

```bash
# Interactive mode — prompts for goal
npm start

# Pass goal directly
npm start "Open Settings"
npm start "Search for cats on YouTube"
npm start "Turn on WiFi"
npm start "Send hello on WhatsApp to Mom"
```

### YAML flow (no LLM)

Declarative steps from a YAML file: **structured** steps (`tap:`, `wait:`, `launchApp`, …) and/or **natural language** lines (`open … app`, `click on …`, `swipe up`). Does not use `LLM_API_KEY`.

```bash
npm start -- --flow examples/flows/google-search.yaml
npm start -- --flow examples/flows/vodqa-natural.yaml
```

See [`examples/flows/`](./examples/flows/) and **Operating modes** for how taps resolve (DOM poll + optional Stark).

### Record and replay

Record a goal execution so you can replay it later **without LLM costs**:

```bash
# Record
npm start -- --record "Send hello on WhatsApp to Mom"
# Saves to recordings/rec-<timestamp>.json

# Replay (adaptive — handles layout changes)
npm start -- --replay recordings/rec-1710000000.json
```

The replayer doesn't blindly repeat coordinates. It reads the current screen, matches recorded elements by text/accessibility ID, and adapts to layout changes.

### Goal decomposition

For complex multi-app goals, use `--plan` to let the LLM break the goal into sub-goals first:

```bash
npm start -- --plan "Copy the weather forecast and send it to my team on Slack"
```

Output:
```
📋 Plan (4 sub-goals):
⬜ 1. Open the Weather app
⬜ 2. Read the current forecast
⬜ 3. Open Slack and navigate to the team channel
⬜ 4. Paste and send the forecast

[1/4] Running: "Open the Weather app"
  Step 1/30: launch → "com.weather" ...
  ✅ Goal completed in 2 steps

[2/4] Running: "Read the current forecast"
  ...
```

### Connect to remote appium-mcp

By default, AppClaw spawns appium-mcp as a subprocess (stdio). To connect to a remote server via SSE:

```env
MCP_TRANSPORT=sse
MCP_HOST=your-server.com
MCP_PORT=8080
```

## Configuration

All configuration is via environment variables (`.env` file):

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | LLM provider: `anthropic`, `openai`, `gemini`, `groq`, `ollama` |
| `LLM_API_KEY` | — | API key for the LLM provider (not needed for Ollama) |
| `LLM_MODEL` | (auto) | Model override. Defaults: `claude-sonnet-4-20250514`, `gpt-4o`, `gemini-2.0-flash`, `llama-3.3-70b-versatile`, `llama3.2` |
| `MCP_TRANSPORT` | `stdio` | How to connect to appium-mcp: `stdio` (subprocess) or `sse` (remote) |
| `MCP_HOST` | `localhost` | Host for SSE transport |
| `MCP_PORT` | `8080` | Port for SSE transport |
| `MAX_STEPS` | `30` | Maximum steps per goal before giving up |
| `STEP_DELAY` | `500` | Milliseconds to wait between steps for UI to settle |
| `MAX_ELEMENTS` | `40` | Maximum UI elements sent to the LLM per step |
| `AGENT_MODE` | `dom` | `dom` = XML locators primary; `vision` = screenshot-first, skip page source in loop — see **Operating modes** above |
| `VISION_MODE` | `fallback` | When to attach screenshots for the planner: `always`, `fallback`, `never` (mainly affects DOM / hybrid paths) |
| `LOG_DIR` | `logs` | Directory for session logs |
| `VISION_LOCATE_PROVIDER` | `appium_mcp` | With `AGENT_MODE=vision`: `stark` (df-vision + Gemini in AppClaw) or `appium_mcp` (MCP `ai_instruction`) |
| `VISION_LOCATE_LOG` | `true` | `[vision-locate] stark-vision | …` vs `mcp vision | …` per NL locate (`false` to disable) |
| `STARK_VISION_API_KEY` | — | Gemini key for Stark (optional if `GEMINI_API_KEY` or `LLM_PROVIDER=gemini` + `LLM_API_KEY`) |
| `GEMINI_API_KEY` | — | Shared Gemini key; used by Stark when `STARK_VISION_API_KEY` is empty |
| `STARK_VISION_MODEL` | (see below) | Stark GenAI model. If unset and `LLM_PROVIDER=gemini`, uses `LLM_MODEL`; else default `gemini-2.5-flash` |
| `AI_VISION_ENABLED` | `false` | Must be `true` for **`AGENT_MODE=vision` + `appium_mcp`**. In **`AGENT_MODE=dom`**, enables optional `ai_instruction` fallback when ids fail |
| `AI_VISION_API_BASE_URL` / `AI_VISION_API_KEY` / `AI_VISION_MODEL` | — | appium-mcp server-side vision (when using MCP path) |
| `AI_VISION_COORD_TYPE` | `normalized` | Coordinate space for MCP vision (`normalized` \| `absolute`) |
| `SHOW_TOKEN_USAGE` | `false` | `true` = print per-step token lines + run summary |
| `LLM_SCREENSHOT_MAX_EDGE_PX` | `0` | Max width/height for **planner** screenshots (`0` = off). Does not change Stark’s locate screenshot resolution |

**Stark setup:** `npm install` links **`df-vision`** via `file:../device-farm/packages/stark-vision` (sibling clone). Published installs use `npm install df-vision`. Set `VISION_LOCATE_PROVIDER=stark` and a Gemini key. Coordinates match device-farm hub scaling (`0–1000`, `[y,x]`); AppClaw taps via appium-mcp.

## LLM Providers

| Provider | Vision | Cost | Setup |
|---|---|---|---|
| **Anthropic** (Claude) | Yes | Per token | `LLM_PROVIDER=anthropic` + `LLM_API_KEY` |
| **OpenAI** (GPT-4o) | Yes | Per token | `LLM_PROVIDER=openai` + `LLM_API_KEY` |
| **Google** (Gemini) | Yes | Per token | `LLM_PROVIDER=gemini` + `LLM_API_KEY` |
| **Groq** (Llama) | No | Free tier | `LLM_PROVIDER=groq` + `LLM_API_KEY` |
| **Ollama** (local) | Depends on model | Free | `LLM_PROVIDER=ollama` (no API key needed) |

## Available MCP Tools (32)

AppClaw consumes these from [appium-mcp](https://github.com/appium/appium-mcp) — it doesn't re-implement them:

| Category | Tools |
|---|---|
| **Session** | `create_session`, `delete_session`, `list_sessions`, `selectSession`, `select_platform`, `select_device` |
| **iOS Setup** | `boot_simulator`, `setup_wda`, `install_wda` |
| **Elements** | `appium_find_element`, `appium_click`, `appium_double_tap`, `appium_long_press`, `appium_set_value`, `appium_get_text`, `appium_press_key` |
| **Gestures** | `scroll`, `scroll_to_element`, `swipe`, `appium_drag_and_drop`, `appium_pinch` |
| **Screen** | `appium_get_page_source`, `appium_screenshot`, `appium_get_orientation`, `appium_set_orientation` |
| **Apps** | `appium_activate_app`, `appium_install_app`, `appium_uninstall_app`, `appium_terminate_app`, `appium_list_apps`, `appium_is_app_installed` |
| **Context** | `appium_get_contexts`, `appium_switch_context` |
| **Device** | `appium_set_geolocation`, `appium_get_geolocation`, `open_notifications`, `appium_lock_device`, `appium_unlock_device` |
| **AI** | `appium_generate_tests`, `appium_answer_appium`, `appium_generate_locators` |

## Agent Actions

The LLM can choose from these actions each step:

| Action | Description | Example |
|---|---|---|
| `tap` | Tap an element by ID or coordinates | `tap → "Submit"` |
| `type` | Type text into an input field | `type → "search" text="cats"` |
| `scroll` | Scroll in a direction | `scroll down` |
| `swipe` | Swipe gesture | `swipe left` |
| `launch` | Open an app by package/bundle ID | `launch → "com.whatsapp"` |
| `back` | Press back button | |
| `home` | Press home button | |
| `long_press` | Long press an element | |
| `double_tap` | Double tap an element | |
| `pinch` | Pinch zoom gesture | |
| `drag` | Drag from one point to another | |
| `press_key` | Press a hardware key | `press_key → "Enter"` |
| `find_and_tap` | Scroll to find element, then tap | `find_and_tap → "Settings"` |
| `notifications` | Open notification panel | |
| `ask_user` | Pause and ask the user for input | OTP, CAPTCHA, choices |
| `done` | Goal is complete | |

### Smart Typing (Page Source Re-read)

When `smart_type` targets an element, it first checks the screen context to see if the element is actually editable (`EditText`, `AutoCompleteTextView`). If the target is a non-editable container or label (common in apps like Rapido, Uber, etc. where the accessibility label is on a wrapper):

1. **Clicks the target** to navigate/focus the area
2. **Re-reads the page source** from the device
3. **Parses it** to find actual editable elements (`EditText`, `AutoCompleteTextView`)
4. **Picks the right input** (nearest editable to the click target, or the only one on screen)
5. **Types into the real input field**

This prevents the `InvalidElementStateError` that occurs when `set_value` is called on a non-editable element.

### Built-in Skills

Multi-step compound actions that are more reliable than individual steps:

| Skill | What It Does |
|---|---|
| `read_screen` | Auto-scroll + collect all visible text from a page |
| `find_and_tap` | 3-strategy element finder (accessibility ID → xpath → manual scroll+parse) |
| `submit_message` | Smart Send button detection across messaging apps (WhatsApp, Telegram, Slack, etc.) |

## Token Usage & Cost Tracking

AppClaw tracks LLM token consumption per step. Terminal breakdown is **off by default**; set `SHOW_TOKEN_USAGE=true` in `.env` to print per-step lines and an end-of-run summary.

**Per-step output (when enabled):**
```
  2/30  smart_type → "search_field" text="MG road"
        ⟠ tokens: 1523 (in: 1400, out: 123)
```

**End-of-run summary (when `SHOW_TOKEN_USAGE=true`):**
```
  ── Token Usage ──────────────────────────────────
  Model:        gemini-2.0-flash
  Input:        14,320 tokens
  Output:       1,105 tokens
  Total:        15,425 tokens
  Est. cost:    $0.001874
```

Cost is estimated using built-in pricing for supported models:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| `gemini-2.0-flash` | $0.10 | $0.40 |
| `gemini-2.0-flash-lite` | $0.075 | $0.30 |
| `gemini-1.5-flash` | $0.075 | $0.30 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `claude-sonnet-4-20250514` | $3.00 | $15.00 |

To add pricing for a new model, add an entry to `MODEL_PRICING` in `src/constants.ts`:

```typescript
"your-model-id": [inputCostPerMillion, outputCostPerMillion],
```

If a model isn't in the pricing map, tokens are still tracked — cost will show `$0.000000`.

## Failure Recovery

AppClaw handles failures at multiple levels:

| Mechanism | Trigger | Recovery |
|---|---|---|
| **Stuck detection** | Same screen for 3+ steps, or same action repeated 3x | Injects recovery hints into the LLM prompt |
| **Recovery engine** | Stuck for 6+ steps | Auto-rollback via back navigation + alternative path suggestions |
| **Checkpointing** | Every screen change | Saves known-good states for rollback |
| **Human-in-the-loop** | OTP, CAPTCHA, ambiguous choices | Pauses and asks the user via CLI |
| **Action retry** | MCP tool call fails | Catches errors, feeds failure back to LLM for re-planning |

## Project Structure

```
appclaw/
├── src/
│   ├── index.ts                  # CLI entry point
│   ├── config.ts                 # Zod-validated env config
│   ├── constants.ts              # Defaults, provider URLs
│   │
│   ├── mcp/                      # MCP client layer
│   │   ├── client.ts             # Connect to appium-mcp (stdio/SSE)
│   │   ├── tools.ts              # Typed wrappers for 32 tools
│   │   └── types.ts              # MCP types
│   │
│   ├── agent/                    # Agentic brain
│   │   ├── loop.ts               # Perception → reasoning → action loop
│   │   ├── stuck.ts              # Stuck-loop detection
│   │   ├── recovery.ts           # Checkpoint/rollback engine
│   │   ├── human-in-the-loop.ts  # User prompting (OTP, CAPTCHA, etc.)
│   │   └── planner.ts            # Goal decomposition
│   │
│   ├── perception/               # Screen understanding
│   │   ├── screen.ts             # Unified getScreenState()
│   │   ├── android-parser.ts     # UiAutomator2 XML parser
│   │   ├── ios-parser.ts         # XCUITest XML parser
│   │   ├── element-filter.ts     # Score, dedupe, compact elements
│   │   ├── screen-diff.ts        # Screen change detection
│   │   └── types.ts              # UIElement, ScreenState
│   │
│   ├── llm/                      # LLM integration
│   │   ├── provider.ts           # Multi-provider (Vercel AI SDK)
│   │   ├── prompts.ts            # System + user prompt builders
│   │   ├── schemas.ts            # Zod schemas for LLM output
│   │   └── parser.ts             # JSON parse fallbacks
│   │
│   ├── skills/                   # Multi-step compound actions
│   │   ├── index.ts              # Skill router
│   │   ├── read-screen.ts        # Scroll + collect text
│   │   ├── find-and-tap.ts       # Find element + tap
│   │   └── submit-message.ts     # Send button detection
│   │
│   ├── recording/                # Record and replay
│   │   ├── recorder.ts           # Record MCP tool calls
│   │   └── replayer.ts           # Adaptive replay
│   │
│   └── logger.ts                 # Session logging
│
├── examples/
│   └── basic-goal.ts             # Quick-start example
│
├── .env.example                  # Environment template
├── package.json
└── tsconfig.json
```

## Examples

### Basic goal

```typescript
import { createMCPClient } from "./src/mcp/client.js";
import { AppiumTools } from "./src/mcp/tools.js";
import { createLLMProvider } from "./src/llm/provider.js";
import { runAgent } from "./src/agent/loop.js";
import { loadConfig } from "./src/config.js";

const config = loadConfig();
const mcpClient = await createMCPClient({ transport: "stdio", host: "localhost", port: 8080 });
const tools = new AppiumTools(mcpClient);
const llm = createLLMProvider(config);

// Create session
await tools.createSession("android");

// Run goal
const result = await runAgent({
  goal: "Open Settings and navigate to Display",
  tools,
  llm,
  maxSteps: 15,
});

console.log(result.success ? "Done!" : "Failed");
await mcpClient.close();
```

### Record and replay

```typescript
import { ActionRecorder } from "./src/recording/recorder.js";
import { loadRecording, replayRecording } from "./src/recording/replayer.js";

// Record
const recorder = new ActionRecorder("Send message on WhatsApp");
const result = await runAgent({ goal: "...", tools, llm, recorder });
recorder.save(result.success);

// Replay later (no LLM needed)
const recording = loadRecording("recordings/rec-1710000000.json");
await replayRecording(tools, recording, { adaptive: true });
```

### Goal decomposition

```typescript
import { decomposeGoal, createPlanExecutor } from "./src/agent/planner.js";

const plan = await decomposeGoal("Copy weather and send on Slack", model);
const executor = createPlanExecutor(plan.subGoals);

while (!executor.isDone()) {
  const subGoal = executor.current!;
  const result = await runAgent({ goal: subGoal.goal, tools, llm });
  result.success ? executor.markCompleted(result.reason) : executor.markFailed(result.reason);
}
```

## Roadmap

### Phase 3 (planned)
- **Test generation** — convert goal execution into runnable test code
- **Visual regression** — screenshot comparison between runs
- **Accessibility auditing** — WCAG checks while automating
- **App knowledge graph** — map app screens + navigation paths for optimal routing

## Releasing

See **[RELEASE.md](./RELEASE.md)** for versioning, publishing **`df-vision`** vs AppClaw, and replacing `file:` dependencies before a public release.

## License

MIT
