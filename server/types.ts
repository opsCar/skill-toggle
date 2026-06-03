export type ToolName = "claude" | "codex";
export type Category = "skills" | "mcp" | "hooks" | "rules" | "agents" | "plugins" | "workflows" | "tools";
export type ItemKind = "path" | "config-entry" | "session-derived";

export interface InventoryItem {
  id: string;
  tool: ToolName;
  category: Category;
  kind: ItemKind;
  name: string;
  enabled: boolean;
  description: string;
  source: string;
  path?: string;
  backupPath?: string;
  /** Config-entry key path (e.g. ["mcpServers", "demo"]); absent for path/session items. */
  keyPath?: string[];
  /**
   * True when the item ships first-party with the provider CLI (Anthropic for
   * Claude Code, OpenAI for Codex) rather than being user/third-party installed.
   * In practice only vendor tools are built-in: every non-MCP tool is provided
   * by the CLI, while skills/mcp/hooks/rules/agents/plugins always come from
   * user or project config directories.
   */
  builtin: boolean;
  detailAvailable: boolean;
  valid: boolean;
  invalidReason?: string;
  context: ContextStats;
}

export interface ItemDetail extends InventoryItem {
  detail: string;
  detailType: "markdown" | "json" | "text" | "none";
}

export interface ContextStats {
  estimatedTokens: number;
  characters: number;
  bytes: number;
  lines: number;
  metric: "approx_chars_per_token";
  charsPerToken: number;
}

export interface PathItemMeta {
  id: string;
  tool: ToolName;
  category: Category;
  kind: "path";
  name: string;
  source: string;
  originalPath: string;
  payloadPath: string;
}

export interface ConfigEntryMeta {
  id: string;
  tool: ToolName;
  category: Category;
  kind: "config-entry";
  name: string;
  source: string;
  configPath: string;
  keyPath: string[];
  value: unknown;
}
