import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPClient, MCPConfig, MCPToolResult, MCPToolInfo } from "./types.js";
import { theme } from "../ui/terminal.js";

/** Tools that produce verbose output we don't want to log */
const QUIET_TOOLS = new Set([
  "appium_get_page_source",
  "appium_screenshot",
  "appium_list_apps",
]);

const mcpDebug = process.env.MCP_DEBUG === "1" || process.env.MCP_DEBUG === "true";

function logMCP(name: string, args: Record<string, unknown>, result: MCPToolResult): void {
  if (!mcpDebug) return;
  if (QUIET_TOOLS.has(name)) return;

  // Format args compactly
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`)
    .join(" ");

  // Extract response text
  const resText = result.content
    ?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
    .join(" ")
    .slice(0, 200) ?? "";

  console.log(`        ${theme.dim("mcp")} ${theme.info(name)} ${theme.dim(argStr)}`);
  if (resText) {
    console.log(`        ${theme.dim("  ⤷")} ${theme.dim(resText)}`);
  }
}

export async function createMCPClient(config: MCPConfig): Promise<MCPClient> {
  const client = new Client({ name: "appclaw", version: "0.1.0" });

  if (config.transport === "stdio") {
    // Detect Android SDK path for appium-mcp subprocess
    const androidHome = process.env.ANDROID_HOME ||
      process.env.ANDROID_SDK_ROOT ||
      `${process.env.HOME}/Library/Android/sdk`;

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["appium-mcp@latest"],
      env: {
        ...process.env,
        ANDROID_HOME: androidHome,
        ANDROID_SDK_ROOT: androidHome,
        PATH: `${androidHome}/platform-tools:${androidHome}/emulator:${process.env.PATH}`,
        // AI Vision env vars — explicitly forwarded to appium-mcp subprocess
        ...(process.env.AI_VISION_API_BASE_URL && { AI_VISION_API_BASE_URL: process.env.AI_VISION_API_BASE_URL }),
        ...(process.env.AI_VISION_API_KEY && { AI_VISION_API_KEY: process.env.AI_VISION_API_KEY }),
        ...(process.env.AI_VISION_MODEL && { AI_VISION_MODEL: process.env.AI_VISION_MODEL }),
        ...(process.env.AI_VISION_COORD_TYPE && { AI_VISION_COORD_TYPE: process.env.AI_VISION_COORD_TYPE }),
        ...(process.env.AI_VISION_IMAGE_MAX_WIDTH && { AI_VISION_IMAGE_MAX_WIDTH: process.env.AI_VISION_IMAGE_MAX_WIDTH }),
        ...(process.env.AI_VISION_IMAGE_QUALITY && { AI_VISION_IMAGE_QUALITY: process.env.AI_VISION_IMAGE_QUALITY }),
      },
      stderr: "pipe",
    });

    // Log appium-mcp stderr for debugging (especially AI vision errors)
    if (transport.stderr) {
      transport.stderr.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && mcpDebug) {
          console.error(`  ${theme.dim("[appium-mcp]")} ${theme.dim(msg)}`);
        }
      });
    }

    await client.connect(transport);
  } else {
    const url = new URL(`http://${config.host}:${config.port}/sse`);
    const transport = new SSEClientTransport(url);
    await client.connect(transport);
  }

  return {
    async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
      const result = await client.callTool({ name, arguments: args });
      const typed = result as MCPToolResult;
      logMCP(name, args, typed);
      return typed;
    },

    async listTools(): Promise<MCPToolInfo[]> {
      const { tools } = await client.listTools();
      return tools as MCPToolInfo[];
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
}
