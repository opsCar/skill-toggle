import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Category, InventoryItem, ToolName } from "./types";

export interface UsageStats {
  total: number;
  claude: number;
  codex: number;
  skill: number;
  mcp: number;
  hook: number;
  tool: number;
  rule: number;
  lastUsed?: string;
  evidence: string[];
}

type UsageKind = "skill" | "mcp" | "hook" | "tool" | "rule";
type UsageSource = "claude" | "codex";

interface UsageEvent {
  source: UsageSource;
  kind: UsageKind;
  name: string;
  timestamp?: string;
  evidence: string;
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

async function collectUsageEvents(): Promise<UsageEvent[]> {
  const [claude, codex] = await Promise.all([collectClaudeEvents(), collectCodexEvents()]);
  return [...claude, ...codex];
}

async function collectClaudeEvents() {
  const root = path.join(home, ".claude", "projects");
  const files = (await walk(root, 5)).filter((file) => file.endsWith(".jsonl"));
  const chunks = await Promise.all(files.map((file) => eventsFromJsonl(file, "claude")));
  return chunks.flat();
}

async function collectCodexEvents() {
  const root = path.join(home, ".codex", "sessions");
  const files = (await walk(root, 5)).filter((file) => file.endsWith(".jsonl"));
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
    (event) => item.category === "hooks" && event.kind === "hook" && pathText.includes(normalize(event.name))
  ];
}

function kindForCategory(category: Category): UsageKind {
  if (category === "skills") return "skill";
  if (category === "mcp") return "mcp";
  if (category === "hooks") return "hook";
  if (category === "rules") return "rule";
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

function normalize(value: string) {
  return value.toLowerCase().replace(/^mcp__/, "").replace(/\.(md|json|toml|yaml|yml)$/i, "");
}

async function walk(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(target, depth - 1);
      if (entry.isFile()) return [target];
      return [];
    })
  );
  return rows.flat();
}

async function safeRead(target: string) {
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
}
