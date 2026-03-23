/** Supported Appium locator strategies */
export type LocatorStrategy =
  | "xpath"
  | "id"
  | "name"
  | "class name"
  | "accessibility id"
  | "css selector"
  | "-android uiautomator"
  | "-ios predicate string"
  | "-ios class chain"
  | "ai_instruction";

/** MCP transport configuration */
export interface MCPConfig {
  transport: "stdio" | "sse";
  host: string;
  port: number;
}

/** Wrapper around MCP client for typed access */
export interface MCPClient {
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
  listTools(): Promise<MCPToolInfo[]>;
  close(): Promise<void>;
}

export interface MCPToolResult {
  content: MCPContent[];
}

export type MCPContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
