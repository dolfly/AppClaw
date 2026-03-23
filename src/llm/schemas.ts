/**
 * Shared types for the agent loop.
 *
 * The action decision schema has been replaced by dynamic tool calling —
 * the LLM now calls tools directly instead of returning a flat JSON object.
 * This file retains ActionResult and helpers used across the codebase.
 */

/** Result of executing an action */
export interface ActionResult {
  success: boolean;
  message: string;
}
