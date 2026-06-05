export type ToolName = "claude" | "codex" | "agents";
export type Category = "skills" | "mcp" | "hooks" | "rules" | "agents" | "plugins" | "workflows" | "tools";

export interface InventoryItem {
  id: string;
  tool: ToolName;
  category: Category;
  kind: "path" | "config-entry" | "session-derived";
  name: string;
  enabled: boolean;
  description: string;
  /** Frontmatter `description` for skills/agents — the routing text that competes to trigger them. */
  routingDescription?: string;
  source: string;
  path?: string;
  backupPath?: string;
  /** True when shipped first-party by the provider CLI (Anthropic/OpenAI). */
  builtin: boolean;
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
  workflow: number;
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

export interface ClaudeTapSourceInfo {
  available: boolean;
  dbPath: string;
  schemaVersion?: number;
  sizeBytes?: number;
  tables: string[];
  sessionCount: number;
  recordCount: number;
  warning?: string;
}

export interface ClaudeTapSession {
  id: string;
  startedAt: string;
  updatedAt: string;
  date: string;
  client: string;
  agent: string;
  agentKey: string;
  proxyMode: string;
  status: string;
  active: boolean;
  live: boolean;
  model: string;
  workspace?: string;
  recordCount: number;
  turnCount: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
  cost: ClaudeTapCostEstimate;
  firstUser: string;
  lastResponse: string;
  error: string;
  skillActivity: ClaudeTapSkillActivity;
  legacyRelPath?: string;
}

export interface ClaudeTapSkillSignal {
  name: string;
  description?: string;
  count: number;
  evidence: string[];
}

export interface ClaudeTapSkillActivity {
  loadedCount: number;
  mentionedCount: number;
  loadedSkills: ClaudeTapSkillSignal[];
  mentionedSkills: ClaudeTapSkillSignal[];
}

export interface ClaudeTapBudgetSummary {
  sessions: number;
  records: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
  uncachedInputTokens: number;
  cacheReadRatio: number;
  avgTokensPerSession: number;
  estimatedCostUsd: number;
  pricedSessions: number;
  unpricedSessions: number;
}

export interface ClaudeTapBreakdownRow {
  key: string;
  sessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export interface ClaudeTapModelPricing {
  model: string;
  provider: "openai" | "anthropic";
  inputPerMTok: number;
  cachedInputPerMTok?: number;
  cacheWritePerMTok?: number;
  outputPerMTok: number;
  source: string;
}

export interface ClaudeTapCostEstimate {
  estimatedUsd: number;
  inputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  pricing?: ClaudeTapModelPricing;
  pricingStatus: "priced" | "unknown-model";
}

export interface ClaudeTapOverview {
  generatedAt: string;
  source: ClaudeTapSourceInfo;
  budget: ClaudeTapBudgetSummary;
  sessions: ClaudeTapSession[];
  byAgent: ClaudeTapBreakdownRow[];
  byModel: ClaudeTapBreakdownRow[];
  pricing: {
    generatedAt: string;
    note: string;
    sources: Array<{ provider: string; url: string; checkedAt: string }>;
  };
}

export type OverlapMethod = "lexical" | "semantic" | "llm";
export type Severity = "high" | "medium" | "low";

export interface FindingItemRef {
  id: string;
  name: string;
  tool: ToolName;
  category: Category;
  builtin: boolean;
}

export interface FindingAction {
  type: "inspect" | "disable";
  itemId: string;
  label: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  items: FindingItemRef[];
  metrics: Record<string, number | string>;
  actions: FindingAction[];
  score: number;
}

export interface DiagnosticRunSummary {
  id: string;
  createdAt: string;
  overlapMethod: OverlapMethod;
  counts: Record<Severity, number>;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  durationMs?: number;
}

export interface LlmTrace {
  prompt: string;
  response: string;
  usage?: LlmUsage;
}

export interface DiagnosticRun extends DiagnosticRunSummary {
  findings: Finding[];
  llmTrace?: LlmTrace;
}

export interface DiagnosticsCapability {
  method: OverlapMethod;
  available: boolean;
  reason?: string;
}

export const OVERLAP_METHOD_LABELS: Record<OverlapMethod, string> = {
  lexical: "Lexical",
  semantic: "Semantic",
  llm: "LLM"
};

export interface ExportSelection {
  filename: string;
  itemIds: string[];
  saveHandle?: FileSystemFileHandle | null;
}

export const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  agents: "Agents"
};

export const CATEGORY_LABELS: Record<Category, string> = {
  skills: "Skills",
  tools: "Tools",
  mcp: "MCP",
  hooks: "Hooks",
  rules: "Rules",
  agents: "Agents",
  plugins: "Plugins",
  workflows: "Workflows"
};

export const CATEGORY_ORDER: Category[] = ["skills", "tools", "agents", "plugins", "workflows", "mcp", "hooks", "rules"];
