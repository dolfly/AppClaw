import { Config, type AppClawConfig } from "../config.js";

/** API key used by StarkVisionClient */
export function getStarkVisionApiKey(): string {
  const explicit = (Config.STARK_VISION_API_KEY || Config.GEMINI_API_KEY).trim();
  if (explicit) return explicit;
  if (Config.LLM_PROVIDER === "gemini" && Config.LLM_API_KEY.trim()) {
    return Config.LLM_API_KEY.trim();
  }
  return "";
}

/**
 * Gemini model id for Stark. Prefer STARK_VISION_MODEL; if unset and the agent LLM is Gemini, reuse LLM_MODEL
 * (avoids 404s when the default model is not enabled for the project).
 */
export function getStarkVisionModel(): string {
  const explicit = Config.STARK_VISION_MODEL.trim();
  if (explicit) return explicit;
  if (Config.LLM_PROVIDER === "gemini" && Config.LLM_MODEL.trim()) {
    return Config.LLM_MODEL.trim();
  }
  return "gemini-2.5-flash";
}

function starkConfigured(c: AppClawConfig): boolean {
  if ((c.STARK_VISION_API_KEY || c.GEMINI_API_KEY).trim().length > 0) return true;
  if (c.LLM_PROVIDER === "gemini" && c.LLM_API_KEY.trim().length > 0) return true;
  return false;
}

/** Whether NL visual locate is available (Stark or appium ai_instruction). */
export function isVisionLocateEnabledFromConfig(c: AppClawConfig): boolean {
  if (c.VISION_LOCATE_PROVIDER === "stark") {
    return starkConfigured(c);
  }
  return c.AI_VISION_ENABLED;
}

/** Uses process-wide `Config` (same as CLI). */
export function isVisionLocateEnabled(): boolean {
  return isVisionLocateEnabledFromConfig(Config);
}
