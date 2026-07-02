export type ToolName = "claude" | "codex" | "agents";
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
  /** Frontmatter `description` for skills/agents — the routing text that competes to trigger them. */
  routingDescription?: string;
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

export interface ProfileEntry {
  id: string;
  name: string;
  tool: ToolName;
  category: Category;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Whitelist: these items should be ON; everything else governable is forced OFF. */
  enabled: ProfileEntry[];
}

export interface ProfileApplyChange extends ProfileEntry {
  action: "enabled" | "disabled";
  ok: boolean;
  error?: string;
}

export interface ProfileApplyResult {
  profileId: string;
  /** On dryRun these are planned changes; otherwise they are executed results. */
  toEnable: ProfileApplyChange[];
  toDisable: ProfileApplyChange[];
  unchanged: number;
  failures: ProfileApplyChange[];
  /** Whitelist entries that are no longer present in the inventory. */
  missing: ProfileEntry[];
  dryRun: boolean;
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

/** Result of an AI-driven profile creation from a GitHub skills repo. */
export interface AiProfileResult {
  profile: Profile;
  /** All skill folder names the assistant reported finding in the repo. */
  skills: string[];
  /** Skills newly installed by this run. */
  installed: string[];
  /** Skills that were already installed before this run. */
  alreadyPresent: string[];
  warnings: string[];
  llm: {
    prompt: string;
    response: string;
    usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number };
  };
}
