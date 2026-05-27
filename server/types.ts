export type ToolName = "claude" | "codex";
export type Category = "skills" | "mcp" | "hooks" | "rules" | "agents" | "plugins";
export type ItemKind = "path" | "config-entry";

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
