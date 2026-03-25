<p align="center">
  <img src="landing/logo.svg" alt="AppClaw logo" width="120" height="120">
</p>

<h1 align="center">AppClaw</h1>

<p align="center">AI-powered mobile automation agent for Android and iOS. Tell it what to do in plain English — it figures out what to tap, type, and swipe.</p>

<table align="center">
<tr>
<td valign="middle" align="center">

<img src="landing/demo.gif" alt="AppClaw demo" width="280">

</td>
<td valign="middle">

```
You: "Send a WhatsApp message to Mom
      saying good morning"

AppClaw:
  Step 1: Open WhatsApp
  Step 2: Search for Mom
  Step 3: Open chat with Mom
  Step 4: Type "good morning"
  Step 5: Tap Send
  Step 6: Done

  ✅ Goal completed in 6 steps.
```

</td>
</tr>
</table>

## Prerequisites

1. **Node.js** 18+
2. **Device connected** — USB, emulator, or simulator
3. **Gemini API key** from [Google AI Studio](https://aistudio.google.com/)

## Installation

### From npm

```bash
npm install -g appclaw
```

Create a `.env` file in your working directory:

```bash
cp .env.example .env
```

### Local development

```bash
git clone https://github.com/AppiumTestDistribution/appclaw.git
cd appclaw
npm install
cp .env.example .env
```

Edit `.env` based on your preferred mode:

<details>
<summary><strong>Vision + Stark (recommended)</strong></summary>

Screenshot-first mode using Stark (df-vision + Gemini) for element location. Requires a Gemini API key.

```env
LLM_PROVIDER=gemini
LLM_API_KEY=your-gemini-api-key
LLM_MODEL=gemini-3.1-flash-lite-preview
AGENT_MODE=vision
VISION_LOCATE_PROVIDER=stark
```

</details>

<details>
<summary><strong>Vision + Appium MCP</strong></summary>

Screenshot-first mode using appium-mcp's server-side AI vision for element location. See [appium-mcp AI Vision setup](https://github.com/appium/appium-mcp?tab=readme-ov-file#ai-vision-element-finding) for details.

```env
LLM_PROVIDER=gemini
LLM_API_KEY=your-gemini-api-key
LLM_MODEL=gemini-3.1-flash-lite-preview
AGENT_MODE=vision
VISION_LOCATE_PROVIDER=appium_mcp
AI_VISION_ENABLED=true
AI_VISION_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_VISION_API_KEY=your-vision-api-key
AI_VISION_MODEL=gemini-2.0-flash
```

</details>

<details>
<summary><strong>DOM mode</strong></summary>

Uses XML page source to find elements by accessibility ID, xpath, etc. No vision needed — works with any LLM provider.

```env
LLM_PROVIDER=gemini            # or anthropic, openai, groq, ollama
LLM_API_KEY=your-api-key
AGENT_MODE=dom
```

</details>

## Usage

```bash
# Interactive mode
appclaw

# Pass goal directly
appclaw "Open Settings"
appclaw "Search for cats on YouTube"
appclaw "Turn on WiFi"
appclaw "Send hello on WhatsApp to Mom"

# Or with npx (no global install)
npx appclaw "Open Settings"
```

When running from a local clone, use `npm start` instead:

```bash
npm start
npm start "Open Settings"
```

### YAML flows (no LLM needed)

Run declarative steps from a YAML file:

```bash
appclaw --flow examples/flows/google-search.yaml
```


## Configuration

All configuration is via `.env`:

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | LLM provider (currently only `gemini` is supported for vision) |
| `LLM_API_KEY` | — | Gemini API key |
| `LLM_MODEL` | (auto) | Model override (e.g. `gemini-2.0-flash`) |
| `AGENT_MODE` | `vision` | `dom` (XML locators) or `vision` (screenshot-first) |
| `VISION_LOCATE_PROVIDER` | `stark` | Vision backend for locating elements |
| `MAX_STEPS` | `30` | Max steps per goal |
| `STEP_DELAY` | `500` | Milliseconds between steps |
| `SHOW_TOKEN_USAGE` | `false` | Print token usage and cost per step |

## How It Works

Each step, AppClaw:
1. **Perceives** — reads the device screen (UI elements or screenshot)
2. **Reasons** — sends the goal + screen state to an LLM, which decides the next action
3. **Acts** — executes the action (tap, type, swipe, launch app, etc.)
4. **Repeats** until the goal is complete or max steps reached

### Agent Actions

| Action | Description |
|---|---|
| `tap` | Tap an element |
| `type` | Type text into an input |
| `scroll` / `swipe` | Scroll or swipe gesture |
| `launch` | Open an app |
| `back` / `home` | Navigation buttons |
| `long_press` / `double_tap` | Touch gestures |
| `find_and_tap` | Scroll to find, then tap |
| `ask_user` | Pause for user input (OTP, CAPTCHA) |
| `done` | Goal complete |

### Failure Recovery

| Mechanism | What it does |
|---|---|
| **Stuck detection** | Detects repeated screens/actions, injects recovery hints |
| **Checkpointing** | Saves known-good states for rollback |
| **Human-in-the-loop** | Pauses for OTP, CAPTCHA, or ambiguous choices |
| **Action retry** | Feeds failures back to the LLM for re-planning |

## License

Licensed under the Apache License, Version 2.0. See `LICENSE` for the full text.
