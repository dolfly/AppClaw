/**
 * AppClaw CLI — Agentic AI layer for mobile automation via appium-mcp.
 *
 * Usage:
 *   npx tsx src/index.ts                          # interactive mode
 *   npx tsx src/index.ts "Open Settings"           # run goal directly
 *   npx tsx src/index.ts --record "Open Settings"  # run + record for replay
 *   npx tsx src/index.ts --replay <file>           # replay a recording
 *   npx tsx src/index.ts --flow <file.yaml>        # run declarative YAML steps (no LLM)
 *   npx tsx src/index.ts --plan "complex goal"     # decompose + run sub-goals
 */

import { loadConfig } from "./config.js";
import { createMCPClient } from "./mcp/client.js";
import { extractText } from "./mcp/tools.js";
import { androidCreateSessionArgs } from "./mcp/session-caps.js";
import { createLLMProvider, buildModel, buildThinkingOptions } from "./llm/provider.js";
import { getScreenState } from "./perception/screen.js";
import { AppResolver } from "./agent/app-resolver.js";
import { runAgent } from "./agent/loop.js";
import { SessionLogger } from "./logger.js";
import { ActionRecorder } from "./recording/recorder.js";
import { loadRecording, replayRecording } from "./recording/replayer.js";
import { parseFlowYamlFile } from "./flow/parse-yaml-flow.js";
import { runYamlFlow } from "./flow/run-yaml-flow.js";
import { decomposeGoal, createPlanExecutor, evaluateSubGoal, evaluateScreen, assessScreenReadiness } from "./agent/planner.js";
import { DEFAULT_MODELS } from "./constants.js";
import { getStarkVisionModel } from "./vision/locate-enabled.js";
import { prepareScreenshotForLlm } from "./vision/prepare-screenshot-for-llm.js";
import * as ui from "./ui/terminal.js";

interface CLIArgs {
  goal: string;
  record: boolean;
  replay: string | null;
  flow: string | null;
  plan: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  let record = false;
  let replay: string | null = null;
  let flow: string | null = null;
  let plan = false;
  const goalParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--record") {
      record = true;
    } else if (args[i] === "--replay") {
      replay = args[++i] ?? null;
    } else if (args[i] === "--flow") {
      flow = args[++i] ?? null;
    } else if (args[i] === "--plan") {
      plan = true;
    } else {
      goalParts.push(args[i]);
    }
  }

  return { goal: goalParts.join(" ").trim(), record, replay, flow, plan };
}

async function main() {
  const config = loadConfig();
  const cliArgs = parseArgs();

  // ─── Replay mode ──────────────────────────────────────
  if (cliArgs.replay) {
    ui.printHeader();
    ui.printReplayHeader(cliArgs.replay);
    const recording = loadRecording(cliArgs.replay);

    const mcpClient = await createMCPClient({
      transport: config.MCP_TRANSPORT,
      host: config.MCP_HOST,
      port: config.MCP_PORT,
    });
    const mcp = mcpClient;

    try {
      const result = await replayRecording(mcpClient, recording, {
        adaptive: true,
        stepDelay: config.STEP_DELAY,
        maxElements: config.MAX_ELEMENTS,
      });
      process.exit(result.success ? 0 : 1);
    } finally {
      await mcpClient.close();
    }
    return;
  }

  // ─── YAML flow mode (no LLM) ───────────────────────────
  if (cliArgs.flow) {
    ui.printHeader();
    ui.printYamlFlowHeader(cliArgs.flow);

    const mcpClient = await createMCPClient({
      transport: config.MCP_TRANSPORT,
      host: config.MCP_HOST,
      port: config.MCP_PORT,
    });
    const mcp = mcpClient;

    try {
      let parsed;
      try {
        parsed = parseFlowYamlFile(cliArgs.flow);
      } catch (err) {
        ui.printError("Invalid flow YAML", String(err));
        process.exit(1);
      }

      ui.startSpinner("Creating Appium session…");
      try {
        const sessionResult = await mcp.callTool("create_session", androidCreateSessionArgs(config));
        const resultText = extractText(sessionResult);
        if (resultText.toLowerCase().includes("error") || resultText.toLowerCase().includes("failed")) {
          throw new Error(resultText);
        }
        ui.stopSpinner();
        ui.printSetupOk("Appium session created");
      } catch (err: unknown) {
        ui.stopSpinner();
        const msg = err instanceof Error ? err.message : String(err);
        ui.printSetupError(`Failed to create Appium session: ${msg}`, "Connect a device/emulator: adb devices");
        process.exit(1);
      }

      const flowAppResolver = new AppResolver();
      await flowAppResolver.initialize(mcp);

      const result = await runYamlFlow(mcp, parsed.meta, parsed.steps, {
        stepDelayMs: config.STEP_DELAY,
        appResolver: flowAppResolver,
      });
      process.exit(result.success ? 0 : 1);
    } finally {
      await mcpClient.close();
    }
    return;
  }

  // ─── Normal / Record / Plan mode ──────────────────────

  // Validate LLM API key
  if (config.LLM_PROVIDER !== "ollama" && !config.LLM_API_KEY) {
    ui.printError(
      `LLM_API_KEY is required for provider "${config.LLM_PROVIDER}".`,
      `Set it in .env or as an environment variable.`
    );
    process.exit(1);
  }

  // Get goal
  let goal = cliArgs.goal;
  if (!goal) {
    goal = await promptGoal();
  }
  if (!goal) {
    ui.printError("No goal provided. Exiting.");
    process.exit(1);
  }

  ui.printHeader();
  ui.startSpinner(`Connecting to appium-mcp (${config.MCP_TRANSPORT})...`);

  const mcpClient = await createMCPClient({
    transport: config.MCP_TRANSPORT,
    host: config.MCP_HOST,
    port: config.MCP_PORT,
  });

  const mcp = mcpClient;
  const logger = new SessionLogger(config.LOG_DIR);

  const modelName = config.LLM_MODEL || DEFAULT_MODELS[config.LLM_PROVIDER] || "default";

  // Set up recorder if --record flag
  const recorder = cliArgs.record ? new ActionRecorder(goal) : undefined;

  try {
    // Verify MCP connection and discover tools dynamically
    const availableTools = await mcpClient.listTools();
    ui.stopSpinner();
    const thinkingLabel = config.LLM_THINKING === "on" && buildThinkingOptions(config)
      ? `on (budget: ${config.LLM_THINKING_BUDGET} tokens)`
      : "off";
    const setupRows: [string, string][] = [
      ["Provider", `${config.LLM_PROVIDER} (${modelName})`],
      ["Thinking", thinkingLabel],
      ["Agent Mode", config.AGENT_MODE === "vision" ? "vision (AI vision-first)" : "dom (DOM locators)"],
      [
        "Vision locate",
        config.VISION_LOCATE_PROVIDER === "stark"
          ? `stark (${getStarkVisionModel()})`
          : "appium_mcp (ai_instruction)",
      ],
      ["Transport", config.MCP_TRANSPORT],
      ["Tools", `${availableTools.length} MCP tools`],
    ];
    if (config.LLM_SCREENSHOT_MAX_EDGE_PX > 0) {
      setupRows.push(["LLM screenshot max edge", `${config.LLM_SCREENSHOT_MAX_EDGE_PX}px`]);
    }
    if (config.APPIUM_MJPEG_SERVER_PORT > 0) {
      setupRows.push(["MJPEG server port", String(config.APPIUM_MJPEG_SERVER_PORT)]);
    }
    if (config.APPIUM_MJPEG_SCREENSHOT_URL.trim()) {
      setupRows.push(["MJPEG screenshot URL", config.APPIUM_MJPEG_SCREENSHOT_URL.trim()]);
    }
    ui.printConfig(setupRows);
    if (recorder) {
      ui.printConfig([["Recording", "enabled"]]);
    }
    console.log();

    // Create LLM provider with dynamic tool discovery
    const llm = createLLMProvider(config, availableTools);

    // Create Appium session (required before any device interaction)
    ui.startSpinner("Creating Appium session...");
    try {
      const sessionResult = await mcp.callTool("create_session", androidCreateSessionArgs(config));
      const resultText = extractText(sessionResult);
      if (resultText.toLowerCase().includes("error") || resultText.toLowerCase().includes("failed")) {
        throw new Error(resultText);
      }
      ui.stopSpinner();
      ui.printSetupOk("Appium session created");
    } catch (err: any) {
      ui.stopSpinner();
      ui.printSetupError(`Failed to create Appium session: ${err.message ?? err}`, "Make sure a device/emulator is connected: adb devices");
      process.exit(1);
    }

    // Fetch installed apps for name → package resolution
    const appResolver = new AppResolver();
    await appResolver.initialize(mcp);

    // ─── Always decompose goals into sub-goals ─────────
    ui.printPlanStart();
    const plannerModel = buildModel(config);
    const thinkingOptions = buildThinkingOptions(config);

    const planResult = await decomposeGoal(goal, plannerModel, thinkingOptions);
    const executor = createPlanExecutor(planResult.subGoals);
    ui.stopSpinner();

    if (planResult.isComplex) {
      ui.printPlan(planResult.subGoals, planResult.reasoning);
    } else {
      ui.printInfo("Simple goal — executing directly");
      console.log();
    }

    // Execute each sub-goal sequentially
    let subGoalIdx = 0;
    let totalSteps = 0;
    const allHistory: any[] = [];

    while (!executor.isDone()) {
      const subGoal = executor.current!;

      // Reset action history between sub-goals for clean context
      llm.resetHistory();

      // Each sub-goal gets a proportional share of max steps
      const stepsPerGoal = planResult.isComplex
        ? Math.max(10, Math.floor(config.MAX_STEPS / executor.all.length))
        : config.MAX_STEPS;

      // ─── Screen-aware orchestration ─────────────────────
      // Before executing, check the screen and decide: skip, rewrite, or proceed
      let effectiveGoal = subGoal.goal;

      if (planResult.isComplex && subGoalIdx > 0) {
        ui.startSpinner("Reconciling plan with device…", "orchestrator");
        try {
          // Capture DOM and/or screenshot for orchestration between sub-goals.
          // Match agent loop: skip XML when AGENT_MODE=vision (orchestrator uses screenshot).
          const captureScreenshot = config.VISION_MODE !== "never" || config.AGENT_MODE === "vision";
          const skipOrchestratorPageSource = config.AGENT_MODE === "vision";
          const screenState = await getScreenState(
            mcp,
            config.MAX_ELEMENTS,
            captureScreenshot,
            skipOrchestratorPageSource
          );
          const orchestratorDom =
            skipOrchestratorPageSource && !screenState.dom.trim()
              ? "(Vision mode: XML page source omitted — use the screenshot for visual state.)"
              : screenState.dom;

          const orchestratorScreenshot = await prepareScreenshotForLlm(
            screenState.screenshot,
            config.LLM_SCREENSHOT_MAX_EDGE_PX
          );

          // ─── Step 1: Screen readiness check ──────────────
          // Verify the screen is clean before evaluating the next sub-goal.
          // Detects leftover overlays, unconfirmed input, etc. from previous sub-goal.
          const prevGoal = executor.all[subGoalIdx - 1];
          if (prevGoal) {
            const readiness = await assessScreenReadiness(
              plannerModel,
              prevGoal.goal,
              subGoal.goal,
              orchestratorDom,
              thinkingOptions,
              orchestratorScreenshot,
            );

            if (!readiness.ready) {
              ui.stopSpinner();
              ui.printScreenReadiness(readiness.issues, readiness.suggestedAction);
              // If there's a suggested cleanup action, incorporate it into the goal
              if (readiness.suggestedAction) {
                effectiveGoal = `${readiness.suggestedAction}, then ${subGoal.goal}`;
                ui.printOrchestratorRewrite(subGoal.goal, effectiveGoal);
              }
              ui.startSpinner("Reconciling plan with device…", "orchestrator");
            }
          }

          // ─── Step 2: Sub-goal evaluation ─────────────────
          // Only if readiness didn't already rewrite the goal
          if (effectiveGoal === subGoal.goal) {
            const completedGoalsList = executor.all
              .filter(sg => sg.status === "completed")
              .map(sg => `${sg.goal} → ${sg.result}`);

            const decision = await evaluateSubGoal(
              plannerModel,
              goal,
              subGoal.goal,
              completedGoalsList,
              orchestratorDom,
              thinkingOptions,
              orchestratorScreenshot,
            );

            if (decision.action === "skip") {
              ui.stopSpinner();
              ui.printOrchestratorSkip(subGoal.goal, decision.reason);
              executor.markCompleted(decision.reason);
              subGoalIdx++;
              continue;
            }
            ui.stopSpinner();
            if (decision.action === "rewrite" && decision.rewrittenGoal) {
              ui.printOrchestratorRewrite(subGoal.goal, decision.rewrittenGoal);
              effectiveGoal = decision.rewrittenGoal;
            } else {
              ui.printOrchestratorProceed(subGoal.goal);
            }
          }
        } catch (err) {
          // Orchestrator failed — proceed with original goal
          ui.stopSpinner();
          ui.printWarning(`Orchestrator check failed: ${err}`);
        }
        ui.stopSpinner();
      }

      if (planResult.isComplex) {
        ui.printPlanContext(goal, effectiveGoal, executor.all, subGoalIdx);
      }

      // Build enriched goal with plan context so the LLM doesn't undo progress
      let enrichedGoal = effectiveGoal;
      if (planResult.isComplex) {
        const completedGoals = executor.all
          .filter(sg => sg.status === "completed")
          .map(sg => `✓ ${sg.goal} (${sg.result})`)
          .join("\n");
        const remainingGoals = executor.all
          .filter(sg => sg.status === "pending" && sg.index !== subGoal.index)
          .map(sg => `○ ${sg.goal}`)
          .join("\n");

        if (completedGoals) {
          enrichedGoal += `\n\nCONTEXT — Overall goal: "${goal}"\nAlready completed:\n${completedGoals}`;
          if (remainingGoals) {
            enrichedGoal += `\nStill pending (handled separately — NOT your job):\n${remainingGoals}`;
          }
          enrichedGoal += `\n\nIMPORTANT:`;
          enrichedGoal += `\n- Previous sub-goals are DONE. Do NOT navigate backwards or undo their work.`;
          enrichedGoal += `\n- ONLY perform actions for YOUR current sub-goal: "${effectiveGoal}". Do NOT perform actions for pending sub-goals — they will be handled separately after you call "done".`;
          enrichedGoal += `\n- Once YOUR sub-goal is achieved, call "done" IMMEDIATELY. Do NOT continue to the next step.`;
        }
      }

      const result = await runAgent({
        goal: enrichedGoal,
        displayGoal: effectiveGoal,
        mcp,
        llm,
        appResolver,
        maxSteps: stepsPerGoal,
        stepDelay: config.STEP_DELAY,
        maxElements: config.MAX_ELEMENTS,
        visionMode: config.VISION_MODE,
        recorder,
        modelName,
        onStep: (event) => {
          logger.logStep({
            step: event.step,
            action: event.decision.toolName,
            decision: event.decision,
            result: event.result.message,
            screenHash: "",
          });
        },
        // Screen evaluator: checks for unexpected states mid-execution
        screenEvaluator: planResult.isComplex
          ? (dom, currentGoal, _step) => evaluateScreen(plannerModel, currentGoal, dom, thinkingOptions)
          : undefined,
      });

      totalSteps += result.stepsUsed;
      allHistory.push(...result.history);

      if (result.success) {
        executor.markCompleted(result.reason);
      } else {
        executor.markFailed(result.reason);
        // Stop on failure for dependent sub-goals
        const nextGoal = executor.current;
        if (nextGoal?.dependsOn === subGoalIdx) {
          ui.printError("Dependent sub-goal cannot proceed", `Sub-goal ${subGoalIdx + 1} failed`);
          break;
        }
      }
      subGoalIdx++;
    }

    if (planResult.isComplex) {
      ui.printPlanSummary(executor.all);
    }

    const allDone = executor.all.every((sg) => sg.status === "completed");
    logger.finalize(goal, {
      success: allDone,
      reason: allDone ? "All sub-goals completed" : "Some sub-goals failed",
      stepsUsed: totalSteps,
      history: allHistory,
    });

    if (recorder) recorder.save(allDone);
    process.exit(allDone ? 0 : 1);
  } catch (err: any) {
    ui.stopSpinner();
    ui.printError("Fatal error", err?.message ?? String(err));
    process.exit(1);
  } finally {
    await mcpClient.close();
  }
}

async function promptGoal(): Promise<string> {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    ui.printInteractiveHeader();
    rl.question("  Enter your goal: ", (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

main().catch(console.error);
