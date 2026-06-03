import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Category, InventoryItem, ToolName } from "./types";
import { estimateTokens, safeRead, walkFiles } from "./shared";

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

type UsageKind = "skill" | "mcp" | "hook" | "tool" | "rule" | "agent" | "plugin" | "workflow";
type UsageSource = "claude" | "codex";

interface UsageEvent {
  source: UsageSource;
  kind: UsageKind;
  name: string;
  timestamp?: string;
  evidence: string;
}

export interface ContextProbeBreakdown {
  category: Category;
  items: number;
  estimatedTokens: number;
  characters: number;
  bytes: number;
  lines: number;
}

export interface ContextProbeContributor {
  id: string;
  tool: ToolName;
  category: Category;
  name: string;
  estimatedTokens: number;
  characters: number;
  source: string;
  path?: string;
}

export interface ContextProbeTool {
  tool: ToolName;
  enabledItems: number;
  estimatedContextTokens: number;
  estimatedTotalTokens: number;
  promptTokens: number;
  characters: number;
  bytes: number;
  lines: number;
  breakdown: ContextProbeBreakdown[];
  topContributors: ContextProbeContributor[];
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

const home = os.homedir();
const emptyStats = (): UsageStats => ({
  total: 0,
  claude: 0,
  codex: 0,
  skill: 0,
  mcp: 0,
  hook: 0,
  tool: 0,
  rule: 0,
  agent: 0,
  plugin: 0,
  workflow: 0,
  evidence: []
});

export async function getUsageSummary(items: InventoryItem[]) {
  const events = await collectUsageEvents();
  return {
    generatedAt: new Date().toISOString(),
    scanned: {
      events: events.length,
      claudeProjects: path.join(home, ".claude", "projects"),
      codexSessions: path.join(home, ".codex", "sessions")
    },
    items: items.map((item) => ({ id: item.id, usage: statsForItem(item, events) })),
    top: topStats(events)
  };
}

export function getContextProbe(items: InventoryItem[], prompt = "hello") {
  const promptStats = contextForProbeText(prompt);
  return {
    generatedAt: new Date().toISOString(),
    prompt,
    metric: promptStats.metric,
    charsPerToken: promptStats.charsPerToken,
    caveats: [
      "Estimates use readable Skill Toggle inventory payloads, not provider tokenizers.",
      "Hidden system prompts, live conversation history, automatic repository scans, and model-side tool schemas are not included.",
      "Only currently enabled items are counted in the baseline."
    ],
    tools: (["claude", "codex", "agents"] as const).map((tool) => probeForTool(tool, items, promptStats.estimatedTokens))
  };
}

export async function getStartupProbe() {
  const [codex, claude] = await Promise.all([probeCodexStartup(), probeClaudeStartup()]);
  return {
    generatedAt: new Date().toISOString(),
    metric: "session_history_usage",
    note: "Start a fresh Claude Code or Codex session, send only hello, then refresh to measure a near-blank startup.",
    tools: [codex, claude]
  };
}

function probeForTool(tool: ToolName, items: InventoryItem[], promptTokens: number): ContextProbeTool {
  const enabled = items.filter((item) => item.tool === tool && item.enabled);
  const breakdown = (["skills", "agents", "plugins", "workflows", "mcp", "hooks", "rules", "tools"] as const)
    .map((category) => {
      const categoryItems = enabled.filter((item) => item.category === category);
      return {
        category,
        items: categoryItems.length,
        estimatedTokens: sum(categoryItems, (item) => item.context.estimatedTokens),
        characters: sum(categoryItems, (item) => item.context.characters),
        bytes: sum(categoryItems, (item) => item.context.bytes),
        lines: sum(categoryItems, (item) => item.context.lines)
      };
    })
    .filter((row) => row.items > 0 || row.estimatedTokens > 0);
  const estimatedContextTokens = sum(enabled, (item) => item.context.estimatedTokens);

  return {
    tool,
    enabledItems: enabled.length,
    estimatedContextTokens,
    estimatedTotalTokens: estimatedContextTokens + promptTokens,
    promptTokens,
    characters: sum(enabled, (item) => item.context.characters),
    bytes: sum(enabled, (item) => item.context.bytes),
    lines: sum(enabled, (item) => item.context.lines),
    breakdown,
    topContributors: enabled
      .slice()
      .sort((a, b) => b.context.estimatedTokens - a.context.estimatedTokens)
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        tool: item.tool,
        category: item.category,
        name: item.name,
        estimatedTokens: item.context.estimatedTokens,
        characters: item.context.characters,
        source: item.source,
        path: item.path ?? item.backupPath
      }))
  };
}

function contextForProbeText(text: string) {
  return {
    estimatedTokens: estimateTokens(text),
    metric: "approx_chars_per_token" as const,
    charsPerToken: 4
  };
}

async function probeCodexStartup(): Promise<StartupProbeTool> {
  const candidates = await latestJsonlCandidates(path.join(home, ".codex", "sessions"));
  const selected = candidates.find((candidate) => isCodexWorkspaceSession(candidate.rows)) ?? candidates[0];
  if (!selected) return { tool: "codex", components: [], warning: "No Codex session history found." };
  const file = selected.file;
  const rows = selected.rows;
  const meta = rows.find((row) => row.type === "session_meta")?.payload;
  const workspaceMatched = isCodexWorkspaceSession(rows);
  const firstUserIndex = rows.findIndex((row) => row.type === "event_msg" && row.payload?.type === "user_message");
  const startupRows = firstUserIndex >= 0 ? rows.slice(0, firstUserIndex) : rows;
  const tokenEvent = rows.find((row) => row.type === "event_msg" && row.payload?.type === "token_count")?.payload?.info;
  const loadedTexts = startupRows.flatMap((row) => messageTexts(row));
  const skills = skillNamesFromText(loadedTexts.join("\n"));
  const tools = Array.isArray(meta?.dynamic_tools) ? meta.dynamic_tools : [];
  const components: StartupProbeComponent[] = [];
  if (meta?.base_instructions?.text) components.push(textComponent("base_instructions", "Base instructions", meta.base_instructions.text));
  for (const text of loadedTexts) components.push(textComponent(kindForLoadedText(text), labelForLoadedText(text), text));
  if (skills.length) components.push({ kind: "skill_registry", label: "Available skill registry", count: skills.length, estimatedTokens: estimateTokens(skills.join("\n")), characters: skills.join("\n").length });
  if (tools.length) components.push({ kind: "tool_registry", label: "Dynamic tool declarations", count: tools.length });

  return {
    tool: "codex",
    sessionPath: file,
    timestamp: meta?.timestamp,
    cwd: meta?.cwd,
    version: meta?.cli_version,
    prompt: firstUserIndex >= 0 ? rows[firstUserIndex]?.payload?.message : undefined,
    inputTokens: tokenEvent?.last_token_usage?.input_tokens,
    cachedInputTokens: tokenEvent?.last_token_usage?.cached_input_tokens,
    totalInputTokens: tokenEvent?.last_token_usage?.input_tokens,
    modelContextWindow: tokenEvent?.model_context_window,
    components,
    warning: workspaceMatched ? undefined : `Using latest Codex session from ${meta?.cwd ?? "unknown cwd"} because no session for this workspace was found.`
  };
}

function isCodexWorkspaceSession(rows: any[]) {
  return rows.some((row) => row.type === "session_meta" && row.payload?.cwd === process.cwd());
}

async function probeClaudeStartup(): Promise<StartupProbeTool> {
  const file = await latestJsonl(path.join(home, ".claude", "projects"), (rows) => rows.some((row) => row.cwd === process.cwd()));
  if (!file) return { tool: "claude", components: [], warning: "No Claude Code session history found for this workspace." };
  const rows = await readJsonl(file);
  const firstUsageIndex = rows.findIndex((row) => row.message?.usage);
  const startupRows = firstUsageIndex >= 0 ? rows.slice(0, firstUsageIndex) : rows;
  const usage = firstUsageIndex >= 0 ? rows[firstUsageIndex].message.usage : undefined;
  const firstPrompt = rows.find((row) => row.type === "user" && !row.isMeta && row.message?.role === "user");
  const deferredTools = startupRows.flatMap((row) => row.attachment?.type === "deferred_tools_delta" ? row.attachment.addedNames ?? [] : []);
  const mcpBlocks = startupRows.flatMap((row) => row.attachment?.type === "mcp_instructions_delta" ? row.attachment.addedBlocks ?? [] : []);
  const skillListings = startupRows.flatMap((row) => row.attachment?.type === "skill_listing" && row.attachment.content ? [row.attachment] : []);
  const commandPermissions = startupRows.filter((row) => row.attachment?.type === "command_permissions");
  const metaTexts = startupRows.flatMap((row) => row.isMeta ? messageTexts(row) : []);
  const components = metaTexts.map((text) => textComponent(kindForLoadedText(text), labelForLoadedText(text), text));
  if (deferredTools.length) components.push({ kind: "tool_registry", label: "Deferred tool declarations", count: deferredTools.length });
  for (const listing of skillListings) {
    components.push({
      kind: "skill_registry",
      label: "Available skill registry",
      count: typeof listing.skillCount === "number" ? listing.skillCount : Array.isArray(listing.names) ? listing.names.length : undefined,
      estimatedTokens: estimateTokens(listing.content),
      characters: listing.content.length
    });
  }
  for (const block of mcpBlocks) components.push(textComponent("mcp_instructions", "MCP startup instructions", block));
  if (commandPermissions.length) components.push({ kind: "permissions", label: "Command permissions", count: commandPermissions.length });
  const cacheCreation = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const direct = usage?.input_tokens ?? 0;

  return {
    tool: "claude",
    sessionPath: file,
    timestamp: latestRowTimestamp(rows),
    cwd: rows.find((row) => row.cwd)?.cwd,
    version: rows.find((row) => row.version)?.version,
    prompt: firstPrompt ? textFromContent(firstPrompt.message?.content) : undefined,
    inputTokens: direct,
    cachedInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreation,
    totalInputTokens: usage ? direct + cacheCreation + cacheRead : undefined,
    components
  };
}

async function latestJsonl(root: string, matches: (rows: any[]) => boolean) {
  const candidates = await latestJsonlCandidates(root);
  for (const row of candidates) {
    if (matches(row.rows)) return row.file;
  }
  return undefined;
}

async function latestJsonlCandidates(root: string) {
  const files = await walkFiles(root, 5, (name) => name.endsWith(".jsonl"));
  const candidates = await Promise.all(
    files.map(async (file) => {
      const [rows, stat] = await Promise.all([readJsonl(file), fs.stat(file).catch(() => undefined)]);
      return { file, rows, time: latestSessionTime(rows) ?? stat?.mtimeMs ?? 0 };
    })
  );
  return candidates.sort((a, b) => b.time - a.time);
}

function latestSessionTime(rows: any[]) {
  const timestamp = latestRowTimestamp(rows);
  return timestamp ? Date.parse(timestamp) : undefined;
}

function latestRowTimestamp(rows: any[]) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const timestamp = rows[index]?.timestamp ?? rows[index]?.payload?.timestamp;
    if (typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp))) return timestamp;
  }
  return undefined;
}

async function readJsonl(file: string) {
  const text = await safeRead(file);
  const rows: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Ignore partial session lines.
    }
  }
  return rows;
}

function messageTexts(row: any): string[] {
  const message = row.payload?.type === "message" ? row.payload : row.message;
  if (!message) return [];
  return [textFromContent(message.content)].filter(Boolean);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : part?.text ?? "").filter(Boolean).join("\n");
}

function skillNamesFromText(text: string) {
  return [...text.matchAll(/^- ([A-Za-z0-9_.:-]+): .*\(file: /gm)].map((match) => match[1]);
}

function textComponent(kind: string, label: string, text: string): StartupProbeComponent {
  return { kind, label, estimatedTokens: estimateTokens(text), characters: text.length };
}

function kindForLoadedText(text: string) {
  if (text.includes("<skills_instructions>")) return "skill_discovery_instructions";
  if (text.startsWith("# AGENTS.md instructions")) return "project_rules";
  if (text.startsWith("# CLAUDE.md instructions")) return "project_rules";
  if (text.includes("<environment_context>")) return "environment_context";
  if (text.includes("<app-context>")) return "app_context";
  if (text.startsWith("Base directory for this skill:")) return "activated_skill_body";
  if (text.includes("<permissions instructions>")) return "permissions";
  return "injected_message";
}

function labelForLoadedText(text: string) {
  if (text.includes("<skills_instructions>")) return "Skill discovery instructions";
  if (text.startsWith("# AGENTS.md instructions")) return "AGENTS.md project instructions";
  if (text.startsWith("# CLAUDE.md instructions")) return "CLAUDE.md project instructions";
  if (text.includes("<environment_context>")) return "Environment context";
  if (text.includes("<app-context>")) return "Codex app context";
  if (text.startsWith("Base directory for this skill:")) return "Activated skill body";
  if (text.includes("<permissions instructions>")) return "Permissions and sandbox";
  return "Injected startup message";
}

async function collectUsageEvents(): Promise<UsageEvent[]> {
  const [claude, codex] = await Promise.all([collectClaudeEvents(), collectCodexEvents()]);
  return [...claude, ...codex];
}

async function collectClaudeEvents() {
  const root = path.join(home, ".claude", "projects");
  const files = await walkFiles(root, 5, (name) => name.endsWith(".jsonl"));
  const chunks = await Promise.all(files.map((file) => eventsFromJsonl(file, "claude")));
  return chunks.flat();
}

async function collectCodexEvents() {
  const root = path.join(home, ".codex", "sessions");
  const files = await walkFiles(root, 5, (name) => name.endsWith(".jsonl"));
  const chunks = await Promise.all(files.map((file) => eventsFromJsonl(file, "codex")));
  const globalState = await eventsFromCodexGlobalState();
  return [...chunks.flat(), ...globalState];
}

async function eventsFromJsonl(file: string, source: UsageSource) {
  const text = await safeRead(file);
  const rows: UsageEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      rows.push(...eventsFromRecord(record, source, file));
    } catch {
      // Ignore partial or non-JSON log lines.
    }
  }
  return rows;
}

async function eventsFromCodexGlobalState() {
  const statePath = path.join(home, ".codex", ".codex-global-state.json");
  const text = await safeRead(statePath);
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    const history = parsed?.["electron-persisted-atom-state"]?.["prompt-history"];
    const prompts = Object.values(history ?? {}).flatMap((value) => (Array.isArray(value) ? value : []));
    return prompts.flatMap((prompt) => textEvents(String(prompt), "codex", undefined, statePath));
  } catch {
    return [];
  }
}

function eventsFromRecord(record: any, source: UsageSource, file: string): UsageEvent[] {
  const timestamp = record.timestamp ?? record.payload?.timestamp;
  const events: UsageEvent[] = [];

  for (const name of toolCallNames(record)) {
    const parsed = parseToolName(name);
    events.push({
      source,
      kind: parsed.kind,
      name: parsed.name,
      timestamp,
      evidence: `${path.basename(file)} tool call: ${name}`
    });
  }

  const userText = userMessageText(record);
  if (userText) events.push(...textEvents(userText, source, timestamp, file));

  return events;
}

function toolCallNames(record: any): string[] {
  const names: string[] = [];
  const content = record?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "tool_use" && typeof part.name === "string") names.push(part.name);
    }
  }
  const payload = record?.payload;
  if ((payload?.type === "function_call" || payload?.type === "custom_tool_call") && typeof payload.name === "string") {
    names.push(payload.name);
  }
  return names;
}

function userMessageText(record: any): string {
  if (record?.type !== "user" && record?.payload?.type !== "message") return "";
  const content = record?.message?.content ?? record?.payload?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "input_text") return part.text ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function textEvents(text: string, source: UsageSource, timestamp: string | undefined, file: string): UsageEvent[] {
  const events: UsageEvent[] = [];
  const evidence = `${path.basename(file)} text mention`;
  for (const match of text.matchAll(/\[\$?([A-Za-z0-9_.:-]+)\]\([^)]*\/SKILL\.md\)/g)) {
    events.push({ source, kind: "skill", name: match[1], timestamp, evidence });
  }
  for (const match of text.matchAll(/(?<![\w/])\/([A-Za-z][A-Za-z0-9_.-]{2,})(?![\w/])/g)) {
    events.push({ source, kind: "skill", name: match[1], timestamp, evidence });
  }
  for (const match of text.matchAll(/(?<![\w])\$([A-Za-z][A-Za-z0-9_.:-]{2,})/g)) {
    events.push({ source, kind: "skill", name: match[1], timestamp, evidence });
  }
  for (const match of text.matchAll(/\b(AGENTS\.md|CLAUDE\.md|settings\.json|config\.toml|hooks\.json|mcp\.json)\b/g)) {
    const kind: UsageKind = match[1].includes("mcp") ? "mcp" : match[1].includes("hook") ? "hook" : "rule";
    events.push({ source, kind, name: match[1], timestamp, evidence });
  }
  for (const match of text.matchAll(/\b(agent|subagent|agents)[/: ]+([A-Za-z0-9_.:-]{2,})/gi)) {
    events.push({ source, kind: "agent", name: match[2], timestamp, evidence });
  }
  for (const match of text.matchAll(/\b(plugin|plugins)[/: ]+([A-Za-z0-9_.:-]{2,})/gi)) {
    events.push({ source, kind: "plugin", name: match[2], timestamp, evidence });
  }
  return events;
}

function parseToolName(name: string): { kind: UsageKind; name: string } {
  if (name.startsWith("mcp__")) {
    const [, server, tool] = name.split("__");
    return { kind: "mcp", name: [server, tool].filter(Boolean).join(":") };
  }
  return { kind: "tool", name };
}

function statsForItem(item: InventoryItem, events: UsageEvent[]): UsageStats {
  const stats = emptyStats();
  const matchers = itemMatchers(item);
  for (const event of events) {
    if (!matchers.some((matcher) => matcher(event))) continue;
    stats.total += 1;
    stats[event.source] += 1;
    stats[event.kind] += 1;
    if (event.timestamp && (!stats.lastUsed || Date.parse(event.timestamp) > Date.parse(stats.lastUsed))) {
      stats.lastUsed = event.timestamp;
    }
    if (stats.evidence.length < 4 && !stats.evidence.includes(event.evidence)) stats.evidence.push(event.evidence);
  }
  return stats;
}

function itemMatchers(item: InventoryItem): Array<(event: UsageEvent) => boolean> {
  const name = normalize(item.name);
  const base = normalize(path.basename(item.path ?? item.backupPath ?? item.name));
  const pathText = normalize(item.path ?? item.backupPath ?? "");
  const categoryKind = kindForCategory(item.category);

  return [
    (event) => event.kind === categoryKind && normalize(event.name) === name,
    (event) => event.kind === categoryKind && normalize(event.name) === base,
    (event) => item.category === "mcp" && event.kind === "mcp" && normalize(event.name).includes(name),
    (event) => item.category === "rules" && event.kind === "rule" && pathText.includes(normalize(event.name)),
    (event) => item.category === "hooks" && event.kind === "hook" && pathText.includes(normalize(event.name)),
    (event) => item.category === "agents" && event.kind === "agent" && pathText.includes(normalize(event.name)),
    (event) => item.category === "plugins" && event.kind === "plugin" && pathText.includes(normalize(event.name)),
    (event) => item.category === "tools" && event.kind === "tool" && (normalize(event.name) === normalize(item.path ?? item.name) || normalize(event.name) === name),
    (event) => item.category === "tools" && event.kind === "mcp" && normalize((item.path ?? "").replace(/^mcp__/, "").replace(/__/g, ":")) === normalize(event.name)
  ];
}

function kindForCategory(category: Category): UsageKind {
  if (category === "skills") return "skill";
  if (category === "mcp") return "mcp";
  if (category === "hooks") return "hook";
  if (category === "rules") return "rule";
  if (category === "agents") return "agent";
  if (category === "plugins") return "plugin";
  if (category === "workflows") return "workflow";
  if (category === "tools") return "tool";
  return "tool";
}

function topStats(events: UsageEvent[]) {
  const counts = new Map<string, { kind: UsageKind; name: string; total: number; lastUsed?: string }>();
  for (const event of events) {
    const key = `${event.kind}:${normalize(event.name)}`;
    const row = counts.get(key) ?? { kind: event.kind, name: event.name, total: 0 };
    row.total += 1;
    if (event.timestamp && (!row.lastUsed || Date.parse(event.timestamp) > Date.parse(row.lastUsed))) row.lastUsed = event.timestamp;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total).slice(0, 20);
}

function sum<T>(items: T[], select: (item: T) => number) {
  return items.reduce((acc, item) => acc + select(item), 0);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/^mcp__/, "").replace(/\.(md|json|toml|yaml|yml)$/i, "");
}

