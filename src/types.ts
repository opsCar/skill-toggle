export type ToolName = "claude" | "codex";
export type Category = "skills" | "mcp" | "hooks" | "rules" | "agents" | "plugins" | "tools";

export interface InventoryItem {
  id: string;
  tool: ToolName;
  category: Category;
  kind: "path" | "config-entry" | "session-derived";
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

export interface ArchiveImportItem extends InventoryItem {
  archivePath: string;
  destinationPath: string;
  keyPath?: string[];
}

export interface ImportInspection {
  token: string;
  sources: string[];
  items: ArchiveImportItem[];
}

export interface ItemDetail extends InventoryItem {
  detail: string;
  detailType: "markdown" | "json" | "text" | "none";
}

export interface UsageStats {
  total: number;
  claude: number;
  codex: number;
  skill: number;
  mcp: number;
  hook: number;
  tool: number;
  rule: number;
  agent: number;
  plugin: number;
  lastUsed?: string;
  evidence: string[];
}

export interface ContextStats {
  estimatedTokens: number;
  characters: number;
  bytes: number;
  lines: number;
  metric: "approx_chars_per_token";
  charsPerToken: number;
}

export interface StartupProbeComponent {
  kind: string;
  label: string;
  count?: number;
  estimatedTokens?: number;
  characters?: number;
}

export interface StartupProbeTool {
  tool: ToolName;
  sessionPath?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  prompt?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalInputTokens?: number;
  modelContextWindow?: number;
  components: StartupProbeComponent[];
  warning?: string;
}

export interface StartupProbe {
  generatedAt: string;
  metric: "session_history_usage";
  note: string;
  tools: StartupProbeTool[];
}

export interface ExportSelection {
  filename: string;
  itemIds: string[];
  saveHandle?: FileSystemFileHandle | null;
}

export const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex"
};

export const CATEGORY_LABELS: Record<Category, string> = {
  skills: "Skills",
  tools: "Tools",
  mcp: "MCP",
  hooks: "Hooks",
  rules: "Rules",
  agents: "Agents",
  plugins: "Plugins"
};

export const CATEGORY_ORDER: Category[] = ["skills", "tools", "agents", "plugins", "mcp", "hooks", "rules"];
