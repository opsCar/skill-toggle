import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parse, stringify } from "smol-toml";
import type { Category, ConfigEntryMeta, ContextStats, InventoryItem, ItemDetail, PathItemMeta, ToolName } from "./types";
import { contextForText, emptyContextStats, exists, parseFrontmatterDescription, safeRead, walkFiles } from "./shared";

const home = os.homedir();
const projectRoot = process.env.SKILL_TOGGLE_PROJECT_ROOT ?? process.cwd();
const claudeConfigRoot = process.env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude");
const codexConfigRoot = process.env.CODEX_HOME ?? path.join(home, ".codex");
const agentsConfigRoot = process.env.AGENTS_HOME ?? path.join(home, ".agents");

const TOOL_SCAN_LIMIT_PER_SOURCE = 8;
const TOOL_INVOCATION_SAMPLE = 5;

const toolHome: Record<ToolName, string> = {
  claude: claudeConfigRoot,
  codex: codexConfigRoot,
  agents: agentsConfigRoot
};

const backupHome: Record<ToolName, string> = {
  claude: path.join(home, ".claude_bak"),
  codex: path.join(home, ".codex_bak"),
  agents: path.join(home, ".agents_bak")
};

function idFor(parts: string[]) {
  return crypto.createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function labelFromPath(target: string) {
  const base = path.basename(target);
  return base.replace(/\.(md|json|toml|yaml|yml|js|ts|mjs|cjs)$/i, "");
}

async function listChildren(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function pathItem(
  tool: ToolName,
  category: Category,
  target: string,
  source: string,
  enabled: boolean,
  backupPath?: string,
  validity?: { valid: boolean; invalidReason?: string },
  context: ContextStats = emptyContextStats(),
  routingDescription?: string
): InventoryItem {
  const name = labelFromPath(target);
  return {
    id: idFor(["path", tool, category, target]),
    tool,
    category,
    kind: "path",
    name,
    enabled,
    source,
    routingDescription,
    path: enabled ? target : undefined,
    backupPath,
    // File-backed items always live in user/project config dirs, so they are
    // never first-party. Only vendor tools are built-in (see isBuiltinTool).
    builtin: false,
    detailAvailable: true,
    description: enabled ? target : `Backed up at ${backupPath}`,
    valid: validity?.valid ?? true,
    invalidReason: validity?.invalidReason,
    context
  };
}

// A valid skill is a directory containing a readable SKILL.md whose YAML
// frontmatter declares both `name` and `description`. See:
// https://docs.claude.com/en/docs/claude-code/skills
async function validateSkill(target: string): Promise<{ valid: boolean; invalidReason?: string }> {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (err) {
    return { valid: false, invalidReason: `Path is unreadable (${(err as NodeJS.ErrnoException).code ?? "ENOENT"})` };
  }
  if (!stat.isDirectory()) return { valid: false, invalidReason: "Skill entry is not a directory" };

  const skillFile = path.join(target, "SKILL.md");
  let content: string;
  try {
    content = await fs.readFile(skillFile, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { valid: false, invalidReason: "Missing SKILL.md" };
    return { valid: false, invalidReason: `SKILL.md unreadable (${code ?? "error"})` };
  }

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) return { valid: false, invalidReason: "SKILL.md is missing YAML frontmatter" };

  const block = frontmatterMatch[1];
  const hasField = (field: string) => new RegExp(`^${field}:\\s*(\\S|[|>])`, "m").test(block);
  if (!hasField("name")) return { valid: false, invalidReason: "SKILL.md frontmatter is missing required field: name" };
  if (!hasField("description")) return { valid: false, invalidReason: "SKILL.md frontmatter is missing required field: description" };

  return { valid: true };
}

function configItem(
  tool: ToolName,
  category: Category,
  configPath: string,
  keyPath: string[],
  value: unknown,
  source: string,
  enabled: boolean,
  backupPath?: string,
  context: ContextStats = emptyContextStats()
): InventoryItem {
  const name = keyPath[keyPath.length - 1] || labelFromPath(configPath);
  return {
    id: idFor(["config", tool, category, configPath, ...keyPath]),
    tool,
    category,
    kind: "config-entry",
    name,
    enabled,
    source,
    path: enabled ? configPath : undefined,
    backupPath,
    keyPath,
    // Config-backed entries (MCP servers, hooks) are user-authored.
    builtin: false,
    detailAvailable: true,
    description: enabled ? `${keyPath.join(".")} in ${configPath}` : `Backed up at ${backupPath}`,
    valid: true,
    context
  };
}

const pathSources: Record<ToolName, Record<Category, string[]>> = {
  claude: {
    skills: [path.join(claudeConfigRoot, "skills"), path.join(claudeConfigRoot, ".cursor", "skills"), path.join(projectRoot, ".claude", "skills")],
    mcp: [path.join(claudeConfigRoot, "mcp"), path.join(projectRoot, ".claude", "mcp")],
    hooks: [path.join(claudeConfigRoot, "hooks"), path.join(claudeConfigRoot, ".cursor", "hooks"), path.join(projectRoot, ".claude", "hooks")],
    rules: [
      path.join(claudeConfigRoot, "rules"),
      path.join(claudeConfigRoot, ".cursor", "rules"),
      path.join(claudeConfigRoot, "CLAUDE.md"),
      path.join(projectRoot, "CLAUDE.md"),
      path.join(projectRoot, ".claude", "CLAUDE.md"),
      path.join(projectRoot, ".claude", "rules")
    ],
    agents: [path.join(claudeConfigRoot, "agents"), path.join(projectRoot, ".claude", "agents")],
    plugins: [path.join(claudeConfigRoot, "plugins"), path.join(projectRoot, ".claude", "plugins")],
    workflows: [path.join(claudeConfigRoot, "workflows"), path.join(projectRoot, ".claude", "workflows")],
    tools: []
  },
  codex: {
    skills: [path.join(codexConfigRoot, "skills"), path.join(projectRoot, ".codex", "skills")],
    mcp: [path.join(codexConfigRoot, "mcp"), path.join(projectRoot, ".codex", "mcp")],
    hooks: [path.join(codexConfigRoot, "hooks"), path.join(projectRoot, ".codex", "hooks")],
    rules: [
      path.join(codexConfigRoot, "rules"),
      path.join(codexConfigRoot, "AGENTS.md"),
      path.join(projectRoot, "AGENTS.md"),
      path.join(projectRoot, ".codex", "AGENTS.md"),
      path.join(projectRoot, ".codex", "rules")
    ],
    agents: [path.join(codexConfigRoot, "agents"), path.join(projectRoot, ".codex", "agents")],
    plugins: [path.join(codexConfigRoot, "plugins"), path.join(projectRoot, ".codex", "plugins")],
    // Dynamic workflows are a Claude Code feature; Codex has no equivalent.
    workflows: [],
    tools: []
  },
  // `~/.agents` is the cross-tool agent home (AGENTS standard); its skills are
  // shared, so they are surfaced as their own provider rather than under Codex.
  agents: {
    skills: [path.join(agentsConfigRoot, "skills"), path.join(projectRoot, ".agents", "skills")],
    mcp: [],
    hooks: [],
    rules: [],
    agents: [path.join(agentsConfigRoot, "agents"), path.join(projectRoot, ".agents", "agents")],
    plugins: [],
    workflows: [],
    tools: []
  }
};

async function collectPathItems(tool: ToolName, category: Category) {
  const items: InventoryItem[] = [];
  for (const sourcePath of pathSources[tool][category]) {
    if (!(await exists(sourcePath))) continue;
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      const children = await listChildren(sourcePath);
      for (const child of children) {
        if (child.name.startsWith(".")) continue;
        const childPath = path.join(sourcePath, child.name);
        const validity = category === "skills" ? await validateSkill(childPath) : undefined;
        items.push(pathItem(tool, category, childPath, sourcePath, true, undefined, validity, await contextForPath(childPath), await routingDescriptionForPath(category, childPath)));
      }
    } else {
      items.push(pathItem(tool, category, sourcePath, path.dirname(sourcePath), true, undefined, undefined, await contextForPath(sourcePath), await routingDescriptionForPath(category, sourcePath)));
    }
  }
  return items;
}

// Skills and agents carry a frontmatter `description` (their routing text). For
// a directory the manifest is SKILL.md; for a single-file agent it is the file
// itself. Other categories have no routing description.
async function routingDescriptionForPath(category: Category, target: string): Promise<string | undefined> {
  if (category !== "skills" && category !== "agents") return undefined;
  let manifest = target;
  try {
    if ((await fs.stat(target)).isDirectory()) manifest = path.join(target, "SKILL.md");
  } catch {
    return undefined;
  }
  return parseFrontmatterDescription(await safeRead(manifest));
}

async function collectDisabledPathItems(tool: ToolName) {
  const dir = path.join(backupHome[tool], "items");
  const rows: InventoryItem[] = [];
  for (const child of await listChildren(dir)) {
    if (!child.isDirectory()) continue;
    const metaPath = path.join(dir, child.name, "meta.json");
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as PathItemMeta;
      const validity = meta.category === "skills" ? await validateSkill(meta.payloadPath) : undefined;
      rows.push(pathItem(meta.tool, meta.category, meta.originalPath, meta.source, false, meta.payloadPath, validity, await contextForPath(meta.payloadPath), await routingDescriptionForPath(meta.category, meta.payloadPath)));
    } catch {
      // Ignore malformed backup records; they are surfaced by filesystem inspection if restored manually.
    }
  }
  return rows;
}

const configSources = [
  { tool: "claude" as const, path: path.join(home, ".claude.json"), format: "json" as const },
  { tool: "claude" as const, path: path.join(projectRoot, ".mcp.json"), format: "json" as const },
  { tool: "claude" as const, path: "/Library/Application Support/ClaudeCode/managed-mcp.json", format: "json" as const },
  { tool: "claude" as const, path: path.join(claudeConfigRoot, "settings.json"), format: "json" as const },
  { tool: "claude" as const, path: path.join(home, ".config", "claude", "settings.json"), format: "json" as const },
  { tool: "claude" as const, path: path.join(projectRoot, ".claude", "settings.json"), format: "json" as const },
  { tool: "claude" as const, path: path.join(claudeConfigRoot, ".cursor", "hooks.json"), format: "json" as const },
  { tool: "codex" as const, path: path.join(codexConfigRoot, "config.toml"), format: "toml" as const },
  { tool: "codex" as const, path: path.join(projectRoot, ".codex", "config.toml"), format: "toml" as const }
];

export async function readConfig(configPath: string, format: "json" | "toml") {
  const text = await safeRead(configPath);
  if (!text.trim()) return {};
  try {
    return format === "json" ? JSON.parse(text) : parse(text);
  } catch {
    return {};
  }
}

export function getAt(root: any, keyPath: string[]) {
  return keyPath.reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), root);
}

export function setAt(root: any, keyPath: string[], value: unknown) {
  let cursor = root;
  for (const key of keyPath.slice(0, -1)) {
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keyPath[keyPath.length - 1]] = value;
}

function deleteAt(root: any, keyPath: string[]) {
  let cursor = root;
  for (const key of keyPath.slice(0, -1)) {
    cursor = cursor?.[key];
  }
  if (cursor && typeof cursor === "object") delete cursor[keyPath[keyPath.length - 1]];
}

async function writeConfig(configPath: string, format: "json" | "toml", data: unknown) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const text = format === "json" ? `${JSON.stringify(data, null, 2)}\n` : stringify(data as any);
  await fs.writeFile(configPath, text);
}

function configuredEntries(tool: ToolName, configPath: string, data: any) {
  const entries: Array<{ category: Category; keyPath: string[]; value: unknown }> = [];
  const mcpRoot = tool === "codex" ? data.mcp_servers : data.mcpServers;
  if (mcpRoot && typeof mcpRoot === "object") {
    for (const key of Object.keys(mcpRoot)) entries.push({ category: "mcp", keyPath: [tool === "codex" ? "mcp_servers" : "mcpServers", key], value: mcpRoot[key] });
  }
  const currentProject = tool === "claude" && data.projects && typeof data.projects === "object" ? data.projects[projectRoot] : undefined;
  const projectMcpRoot = currentProject && typeof currentProject === "object" ? currentProject.mcpServers : undefined;
  if (projectMcpRoot && typeof projectMcpRoot === "object") {
    for (const key of Object.keys(projectMcpRoot)) entries.push({ category: "mcp", keyPath: ["projects", projectRoot, "mcpServers", key], value: projectMcpRoot[key] });
  }
  const hooksRoot = data.hooks;
  if (hooksRoot && typeof hooksRoot === "object") {
    for (const key of Object.keys(hooksRoot)) entries.push({ category: "hooks", keyPath: ["hooks", key], value: hooksRoot[key] });
  }
  return entries.map((entry) => configItem(tool, entry.category, configPath, entry.keyPath, entry.value, configPath, true, undefined, contextForValue(entry.value)));
}

async function collectConfigItems() {
  const items: InventoryItem[] = [];
  for (const source of configSources) {
    if (!(await exists(source.path))) continue;
    const data = await readConfig(source.path, source.format);
    items.push(...configuredEntries(source.tool, source.path, data));
  }
  for (const tool of ["claude", "codex"] as const) {
    const dir = path.join(backupHome[tool], "config");
    for (const child of await listChildren(dir)) {
      if (!child.name.endsWith(".json")) continue;
      const backupPath = path.join(dir, child.name);
      try {
        const meta = JSON.parse(await fs.readFile(backupPath, "utf8")) as ConfigEntryMeta;
        items.push(configItem(meta.tool, meta.category, meta.configPath, meta.keyPath, meta.value, meta.source, false, backupPath, contextForValue(meta.value)));
      } catch {
        // Ignore malformed backup records.
      }
    }
  }
  return items;
}

export async function listInventory() {
  const activePathItems = await Promise.all(
    (["claude", "codex", "agents"] as const).flatMap((tool) => (["skills", "mcp", "hooks", "rules", "agents", "plugins", "workflows"] as const).map((category) => collectPathItems(tool, category)))
  );
  const disabledPathItems = await Promise.all((["claude", "codex", "agents"] as const).map(collectDisabledPathItems));
  const configItems = await collectConfigItems();
  const toolItems = await collectToolItems();
  const byId = new Map<string, InventoryItem>();
  [...activePathItems.flat(), ...disabledPathItems.flat(), ...configItems, ...toolItems].forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort((a, b) => `${a.tool}-${a.category}-${a.name}`.localeCompare(`${b.tool}-${b.category}-${b.name}`));
}

interface ToolInvocation {
  timestamp?: string;
  sessionId?: string;
  evidence: string;
  inputPreview?: string;
}

interface ToolAggregate {
  tool: ToolName;
  rawName: string;
  displayName: string;
  group: "core" | "subagent" | "mcp";
  mcpServer?: string;
  callCount: number;
  uniqueSessions: Set<string>;
  declaredInSessions: Set<string>;
  invocations: ToolInvocation[];
  firstSeen?: string;
  lastSeen?: string;
}

async function collectToolItems(): Promise<InventoryItem[]> {
  const aggregates = new Map<string, ToolAggregate>();
  await Promise.all([
    aggregateClaudeToolCalls(aggregates),
    aggregateCodexToolCalls(aggregates)
  ]);
  return [...aggregates.values()].map((aggregate) => toolAggregateToItem(aggregate));
}

function toolAggregateToItem(aggregate: ToolAggregate): InventoryItem {
  const groupLabel = aggregate.group === "mcp" ? `MCP \`${aggregate.mcpServer ?? "unknown"}\`` : aggregate.group;
  const declaredCount = aggregate.declaredInSessions.size;
  const description =
    aggregate.callCount === 0
      ? `${groupLabel} · loaded in ${declaredCount} session${declaredCount === 1 ? "" : "s"} but never called`
      : `${groupLabel} · ${aggregate.callCount} call${aggregate.callCount === 1 ? "" : "s"} across ${aggregate.uniqueSessions.size} session${aggregate.uniqueSessions.size === 1 ? "" : "s"}`;
  const invocationsText = aggregate.invocations
    .slice(0, TOOL_INVOCATION_SAMPLE)
    .map((entry, index) => {
      const stamp = entry.timestamp ? new Date(entry.timestamp).toISOString() : "unknown time";
      const preview = entry.inputPreview ? `\n    ${entry.inputPreview}` : "";
      return `${index + 1}. ${stamp} · ${entry.evidence}${preview}`;
    })
    .join("\n");
  const lastSeenLine = aggregate.lastSeen ? `\nLast call: ${aggregate.lastSeen}` : "";
  const firstSeenLine = aggregate.firstSeen ? `\nFirst call: ${aggregate.firstSeen}` : "";
  const stats =
    aggregate.callCount === 0
      ? `Loaded in ${declaredCount} session${declaredCount === 1 ? "" : "s"}, never called — dead weight in tool catalog`
      : `${aggregate.callCount} call${aggregate.callCount === 1 ? "" : "s"} across ${aggregate.uniqueSessions.size} session${aggregate.uniqueSessions.size === 1 ? "" : "s"} (loaded in ${declaredCount})`;
  const detailText = `Tool: ${aggregate.rawName}\nGroup: ${aggregate.group}${aggregate.mcpServer ? ` (server: ${aggregate.mcpServer})` : ""}\n${stats}${firstSeenLine}${lastSeenLine}\n\nRecent invocations:\n${invocationsText || "  (no calls captured)"}`;

  return {
    id: idFor(["tool", aggregate.tool, aggregate.rawName]),
    tool: aggregate.tool,
    category: "tools",
    kind: "session-derived",
    name: aggregate.displayName,
    enabled: aggregate.callCount > 0,
    source: aggregate.group === "mcp" ? `mcp:${aggregate.mcpServer ?? "unknown"}` : aggregate.group,
    path: aggregate.rawName,
    backupPath: undefined,
    builtin: isBuiltinTool(aggregate.tool, aggregate),
    detailAvailable: true,
    description,
    valid: true,
    context: contextForText(detailText)
  };
}

async function aggregateClaudeToolCalls(aggregates: Map<string, ToolAggregate>) {
  const root = path.join(home, ".claude", "projects");
  const files = await latestSessionFiles(root, TOOL_SCAN_LIMIT_PER_SOURCE);
  for (const file of files) {
    const text = await safeRead(file);
    if (!text) continue;
    const sessionId = path.basename(file, ".jsonl");
    const declared = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const attachment = record?.attachment;
      if (attachment?.type === "deferred_tools_delta") {
        for (const name of asStringArray(attachment.addedNames)) declared.add(name);
        for (const name of asStringArray(attachment.readdedNames)) declared.add(name);
        for (const name of asStringArray(attachment.removedNames)) declared.delete(name);
        continue;
      }
      const content = record?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type !== "tool_use" || typeof part.name !== "string") continue;
        recordToolCall(aggregates, "claude", part.name, {
          timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
          sessionId,
          evidence: `${path.basename(file)}`,
          inputPreview: previewToolInput(part.input)
        });
      }
    }
    for (const name of declared) recordToolDeclaration(aggregates, "claude", name, sessionId);
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function recordToolDeclaration(aggregates: Map<string, ToolAggregate>, tool: ToolName, rawName: string, sessionId: string) {
  const parsed = parseToolName(rawName);
  const key = `${tool}:${parsed.rawName}`;
  let aggregate = aggregates.get(key);
  if (!aggregate) {
    aggregate = {
      tool,
      rawName: parsed.rawName,
      displayName: parsed.displayName,
      group: parsed.group,
      mcpServer: parsed.mcpServer,
      callCount: 0,
      uniqueSessions: new Set<string>(),
      declaredInSessions: new Set<string>(),
      invocations: []
    };
    aggregates.set(key, aggregate);
  }
  aggregate.declaredInSessions.add(sessionId);
}

async function aggregateCodexToolCalls(aggregates: Map<string, ToolAggregate>) {
  const root = path.join(home, ".codex", "sessions");
  const files = await latestSessionFiles(root, TOOL_SCAN_LIMIT_PER_SOURCE);
  for (const file of files) {
    const text = await safeRead(file);
    if (!text) continue;
    const sessionId = path.basename(file, ".jsonl");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type === "session_meta") {
        const dynamicTools = (record.payload as any)?.dynamic_tools;
        if (Array.isArray(dynamicTools)) {
          for (const decl of dynamicTools) {
            const name = typeof decl === "string" ? decl : typeof decl?.name === "string" ? decl.name : undefined;
            if (name) recordToolDeclaration(aggregates, "codex", name, sessionId);
          }
        }
        continue;
      }
      const payload = record?.payload;
      if ((payload?.type !== "function_call" && payload?.type !== "custom_tool_call") || typeof payload.name !== "string") continue;
      recordToolCall(aggregates, "codex", payload.name, {
        timestamp: typeof payload.timestamp === "string" ? payload.timestamp : typeof record.timestamp === "string" ? record.timestamp : undefined,
        sessionId,
        evidence: `${path.basename(file)}`,
        inputPreview: previewToolInput(payload.arguments ?? payload.input)
      });
    }
  }
}

function recordToolCall(aggregates: Map<string, ToolAggregate>, tool: ToolName, rawName: string, invocation: ToolInvocation) {
  const parsed = parseToolName(rawName);
  const key = `${tool}:${parsed.rawName}`;
  let aggregate = aggregates.get(key);
  if (!aggregate) {
    aggregate = {
      tool,
      rawName: parsed.rawName,
      displayName: parsed.displayName,
      group: parsed.group,
      mcpServer: parsed.mcpServer,
      callCount: 0,
      uniqueSessions: new Set<string>(),
      declaredInSessions: new Set<string>(),
      invocations: []
    };
    aggregates.set(key, aggregate);
  }
  aggregate.callCount += 1;
  if (invocation.sessionId) {
    aggregate.uniqueSessions.add(invocation.sessionId);
    aggregate.declaredInSessions.add(invocation.sessionId);
  }
  if (aggregate.invocations.length < TOOL_INVOCATION_SAMPLE * 2) aggregate.invocations.push(invocation);
  if (invocation.timestamp) {
    const t = invocation.timestamp;
    if (!aggregate.firstSeen || t < aggregate.firstSeen) aggregate.firstSeen = t;
    if (!aggregate.lastSeen || t > aggregate.lastSeen) aggregate.lastSeen = t;
  }
}

// Curated lists of first-party tool names, used to label recognized vendor
// tools in detail views. Sources (May 2026):
//   Claude Code  → https://code.claude.com/docs/en/tools-reference
//   Codex CLI    → https://developers.openai.com/codex/cli/features
// These are intentionally non-exhaustive; the authoritative rule for "built-in"
// is isBuiltinTool (any non-MCP tool is provided by the CLI vendor).
const CLAUDE_BUILTIN_TOOLS = new Set([
  "Agent", "AskUserQuestion", "Bash", "BashOutput", "CronCreate", "CronDelete", "CronList",
  "Edit", "EnterPlanMode", "EnterWorktree", "ExitPlanMode", "ExitWorktree", "Glob", "Grep",
  "KillShell", "ListMcpResourcesTool", "LSP", "Monitor", "MultiEdit", "NotebookEdit",
  "NotebookRead", "PowerShell", "PushNotification", "Read", "ReadMcpResourceTool",
  "RemoteTrigger", "ScheduleWakeup", "SendMessage", "ShareOnboardingGuide", "Skill",
  "Task", "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "TaskUpdate",
  "TeamCreate", "TeamDelete", "TodoWrite", "ToolSearch", "WaitForMcpServers", "WebFetch",
  "WebSearch", "Write"
]);
const CODEX_BUILTIN_TOOLS = new Set([
  "shell", "local_shell", "container.exec", "exec_command", "write_stdin", "unified_exec",
  "apply_patch", "update_plan", "web_search", "read_file", "view_image"
]);

/**
 * A tool is "built-in" when the CLI vendor ships it. In both Claude Code and
 * Codex the only way to add a tool is to connect an MCP server, so every
 * non-MCP tool (core + subagent groups) is first-party.
 */
export function isBuiltinTool(tool: ToolName, parsed: { rawName: string; group: "core" | "subagent" | "mcp" }): boolean {
  if (parsed.group === "mcp") return false;
  return true;
}

/** Whether a tool name appears in our curated first-party catalog. */
export function isRecognizedBuiltinTool(tool: ToolName, rawName: string): boolean {
  return (tool === "claude" ? CLAUDE_BUILTIN_TOOLS : CODEX_BUILTIN_TOOLS).has(rawName);
}

export function parseToolName(name: string): { rawName: string; displayName: string; group: "core" | "subagent" | "mcp"; mcpServer?: string } {
  if (name.startsWith("mcp__")) {
    const segments = name.split("__");
    const server = segments[1] ?? "unknown";
    const rest = segments.slice(2).join("__");
    return { rawName: name, displayName: rest ? `${server} · ${rest}` : server, group: "mcp", mcpServer: server };
  }
  if (name.toLowerCase().startsWith("subagent_") || name === "Task") {
    return { rawName: name, displayName: name, group: "subagent" };
  }
  return { rawName: name, displayName: name, group: "core" };
}

function previewToolInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  let serialized: string;
  if (typeof input === "string") {
    serialized = input;
  } else {
    try {
      serialized = JSON.stringify(input);
    } catch {
      return undefined;
    }
  }
  serialized = serialized.replace(/\s+/g, " ").trim();
  if (serialized.length === 0) return undefined;
  return serialized.length > 160 ? `${serialized.slice(0, 160)}…` : serialized;
}

async function latestSessionFiles(root: string, limit: number): Promise<string[]> {
  const entries = await walkFiles(root, 6, (name) => name.endsWith(".jsonl"));
  if (entries.length === 0) return [];
  const stats = await Promise.all(
    entries.map(async (file) => {
      try {
        const stat = await fs.stat(file);
        return { file, mtimeMs: stat.mtimeMs };
      } catch {
        return { file, mtimeMs: 0 };
      }
    })
  );
  return stats
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((row) => row.file);
}

async function describePath(target: string) {
  const stat = await fs.stat(target);
  const candidates = stat.isDirectory()
    ? ["SKILL.md", "README.md", "readme.md", "description.md"].map((name) => path.join(target, name))
    : [target];
  for (const candidate of candidates) {
    const content = await safeRead(candidate);
    if (content.trim()) return { detail: content, detailType: candidate.endsWith(".md") ? ("markdown" as const) : ("text" as const) };
  }
  return { detail: `${target}\n\nNo README, SKILL.md, or description file was found.`, detailType: "text" as const };
}

async function contextForPath(target: string): Promise<ContextStats> {
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) return contextForText(await safeRead(target));

  const candidates = ["SKILL.md", "README.md", "readme.md", "description.md"].map((name) => path.join(target, name));
  for (const candidate of candidates) {
    const content = await safeRead(candidate);
    if (content.trim()) return contextForText(content);
  }
  return emptyContextStats();
}

function contextForValue(value: unknown): ContextStats {
  return contextForText(JSON.stringify(value, null, 2));
}

export async function getDetail(id: string): Promise<ItemDetail | undefined> {
  const item = (await listInventory()).find((row) => row.id === id);
  if (!item) return undefined;
  if (item.kind === "session-derived") {
    return { ...item, detail: await describeSessionDerived(item), detailType: "markdown" };
  }
  if (item.kind === "config-entry") {
    const detail = item.enabled
      ? JSON.stringify(getAt(await readConfig(item.path!, item.path!.endsWith(".toml") ? "toml" : "json"), keyPathFor(item)), null, 2)
      : await safeRead(item.backupPath!);
    return { ...item, detail, detailType: "json" };
  }
  const target = item.enabled ? item.path! : item.backupPath!;
  if (item.category === "workflows") {
    return { ...item, ...(await describeWorkflow(target, item.name)) };
  }
  const detail = await describePath(target);
  return { ...item, ...detail };
}

// Dynamic workflows are JavaScript files that orchestrate subagents (each with
// its own context window) to build a task-specific harness on the fly. See:
// https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code
// There is no manifest, so detail is derived from the source: a leading
// description comment plus the workflow body shown verbatim.
async function describeWorkflow(target: string, name: string): Promise<{ detail: string; detailType: "markdown" | "text" }> {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return { detail: `${target}\n\nWorkflow file is unreadable.`, detailType: "text" };
  }
  // A workflow can also ship as a directory (e.g. bundled inside a skill); fall
  // back to the generic describer in that case.
  if (stat.isDirectory()) return describePath(target);

  const source = await safeRead(target);
  const description = leadingCommentText(source);
  const lines = source ? source.split(/\r?\n/).length : 0;
  const header = [
    `# ${name}`,
    "",
    `- Type: dynamic workflow (JavaScript harness)`,
    `- File: \`${target}\``,
    `- Size: ${lines} line${lines === 1 ? "" : "s"}`,
    description ? `\n## Description\n\n${description}` : "\n_No leading description comment found._"
  ].join("\n");
  return { detail: `${header}\n\n## Source\n\n\`\`\`js\n${source.trimEnd()}\n\`\`\`\n`, detailType: "markdown" };
}

// Pull human-readable text from the first leading comment of a JS file — either
// a /** ... */ block or a run of // lines at the top — stripping comment syntax.
function leadingCommentText(source: string): string | undefined {
  const trimmed = source.replace(/^﻿/, "").trimStart();
  const block = trimmed.match(/^\/\*\*?([\s\S]*?)\*\//);
  if (block) {
    const text = block[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*?\s?/, "").trimEnd())
      .join("\n")
      .trim();
    return text || undefined;
  }
  const lineComments: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^\s*\/\/\s?(.*)$/);
    if (!match) break;
    lineComments.push(match[1].trimEnd());
  }
  const text = lineComments.join("\n").trim();
  return text || undefined;
}

async function describeSessionDerived(item: InventoryItem): Promise<string> {
  const aggregates = new Map<string, ToolAggregate>();
  if (item.tool === "claude") await aggregateClaudeToolCalls(aggregates);
  else await aggregateCodexToolCalls(aggregates);
  const entry = [...aggregates.values()].find((row) => idFor(["tool", row.tool, row.rawName]) === item.id);
  if (!entry) {
    return `# ${item.name}\n\nNo session evidence is available for this tool right now. The list reflects the most recent ${TOOL_SCAN_LIMIT_PER_SOURCE} sessions per provider.`;
  }
  const header = [
    `# ${entry.displayName}`,
    "",
    `- Raw name: \`${entry.rawName}\``,
    `- Group: ${entry.group}${entry.mcpServer ? ` (server \`${entry.mcpServer}\`)` : ""}`,
    `- Origin: ${isBuiltinTool(entry.tool, entry) ? `built-in (${entry.tool === "claude" ? "Anthropic" : "OpenAI"})${isRecognizedBuiltinTool(entry.tool, entry.rawName) ? ", recognized" : ""}` : "MCP server"}`,
    `- Provider: ${entry.tool}`,
    `- Loaded in: ${entry.declaredInSessions.size} session${entry.declaredInSessions.size === 1 ? "" : "s"} (scanned)`,
    `- Calls observed: ${entry.callCount}`,
    `- Sessions where called: ${entry.uniqueSessions.size}`,
    entry.firstSeen ? `- First call: ${entry.firstSeen}` : "",
    entry.lastSeen ? `- Last call: ${entry.lastSeen}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  const linkHint =
    entry.group === "mcp" && entry.mcpServer
      ? `\n\n> This tool is provided by the MCP server **${entry.mcpServer}**. To take it (and its sibling tools) out of context, disable that server from the MCP category.`
      : entry.group === "core"
        ? "\n\n> Built-in tool. To restrict it, edit `permissions.deny` in the relevant `settings.json`."
        : "";
  const recent = entry.invocations.slice(0, TOOL_INVOCATION_SAMPLE * 2);
  const invocationsBlock = recent.length
    ? recent
        .map((invocation, index) => {
          const stamp = invocation.timestamp ?? "(no timestamp)";
          const session = invocation.sessionId ? ` · session \`${invocation.sessionId.slice(0, 8)}\`` : "";
          const preview = invocation.inputPreview ? `\n     \`${invocation.inputPreview.replace(/`/g, "ʼ")}\`` : "";
          return `${index + 1}. ${stamp}${session} (${invocation.evidence})${preview}`;
        })
        .join("\n")
    : "_No call samples captured._";
  return `${header}${linkHint}\n\n## Recent invocations\n\n${invocationsBlock}\n`;
}

/**
 * Resolve a config entry's structured key path. Prefer the value carried on the
 * item; fall back to parsing the legacy description only for older backup records.
 */
function keyPathFor(item: InventoryItem): string[] {
  if (item.keyPath && item.keyPath.length > 0) return item.keyPath;
  return item.description.split(" in ")[0].split(".");
}

async function requireItem(id: string): Promise<InventoryItem> {
  const item = (await listInventory()).find((row) => row.id === id);
  if (!item) throw new Error("Item not found");
  return item;
}

export async function toggleItem(id: string, enabled: boolean): Promise<InventoryItem> {
  const item = await requireItem(id);
  if (item.kind === "session-derived") {
    const error = item.source.startsWith("mcp:")
      ? Object.assign(new Error(`This tool is provided by MCP server "${item.source.slice(4)}". Disable that server from the MCP category to remove all of its tools.`), { statusCode: 409 })
      : Object.assign(new Error("Built-in tools are diagnostic-only here. Edit settings.json permissions to restrict them."), { statusCode: 409 });
    throw error;
  }
  if (item.enabled === enabled) return item;

  if (item.kind === "path") {
    const recordDir = path.join(backupHome[item.tool], "items", item.id);
    const payloadPath = path.join(recordDir, "payload");
    const metaPath = path.join(recordDir, "meta.json");
    if (!enabled) {
      if (!item.path) throw new Error("Active path missing");
      await fs.mkdir(recordDir, { recursive: true });
      const meta: PathItemMeta = { id: item.id, tool: item.tool, category: item.category, kind: "path", name: item.name, source: item.source, originalPath: item.path, payloadPath };
      await fs.rename(item.path, payloadPath);
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    } else {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as PathItemMeta;
      await fs.mkdir(path.dirname(meta.originalPath), { recursive: true });
      if (await exists(meta.originalPath)) throw new Error(`Cannot restore because ${meta.originalPath} already exists`);
      await fs.rename(meta.payloadPath, meta.originalPath);
      await fs.rm(recordDir, { recursive: true, force: true });
    }
    return requireItem(id);
  }

  const backupPath = path.join(backupHome[item.tool], "config", `${item.id}.json`);
  if (!enabled) {
    const configPath = item.path!;
    const format = configPath.endsWith(".toml") ? "toml" : "json";
    const data = await readConfig(configPath, format);
    const keyPath = keyPathFor(item);
    const value = getAt(data, keyPath);
    const meta: ConfigEntryMeta = { id: item.id, tool: item.tool, category: item.category, kind: "config-entry", name: item.name, source: item.source, configPath, keyPath, value };
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(meta, null, 2));
    deleteAt(data, keyPath);
    await writeConfig(configPath, format, data);
  } else {
    const meta = JSON.parse(await fs.readFile(backupPath, "utf8")) as ConfigEntryMeta;
    const format = meta.configPath.endsWith(".toml") ? "toml" : "json";
    const data = await readConfig(meta.configPath, format);
    setAt(data, meta.keyPath, meta.value);
    await writeConfig(meta.configPath, format, data);
    await fs.rm(backupPath, { force: true });
  }
  return requireItem(id);
}
