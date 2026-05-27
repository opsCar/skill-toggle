import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parse, stringify } from "smol-toml";
import type { Category, ConfigEntryMeta, ContextStats, InventoryItem, ItemDetail, PathItemMeta, ToolName } from "./types";

const home = os.homedir();
const projectRoot = process.cwd();

const toolHome: Record<ToolName, string> = {
  claude: path.join(home, ".claude"),
  codex: path.join(home, ".codex")
};

const backupHome: Record<ToolName, string> = {
  claude: path.join(home, ".claude_bak"),
  codex: path.join(home, ".codex_bak")
};

function idFor(parts: string[]) {
  return crypto.createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function labelFromPath(target: string) {
  const base = path.basename(target);
  return base.replace(/\.(md|json|toml|yaml|yml|js|ts|mjs|cjs)$/i, "");
}

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(target: string) {
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
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
  context: ContextStats = emptyContextStats()
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
    path: enabled ? target : undefined,
    backupPath,
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
    detailAvailable: true,
    description: enabled ? `${keyPath.join(".")} in ${configPath}` : `Backed up at ${backupPath}`,
    valid: true,
    context
  };
}

const pathSources: Record<ToolName, Record<Category, string[]>> = {
  claude: {
    skills: [path.join(home, ".claude", "skills"), path.join(home, ".claude", ".cursor", "skills"), path.join(projectRoot, ".claude", "skills")],
    mcp: [path.join(home, ".claude", "mcp"), path.join(projectRoot, ".claude", "mcp")],
    hooks: [path.join(home, ".claude", "hooks"), path.join(home, ".claude", ".cursor", "hooks"), path.join(projectRoot, ".claude", "hooks")],
    rules: [
      path.join(home, ".claude", "rules"),
      path.join(home, ".claude", ".cursor", "rules"),
      path.join(home, ".claude", "CLAUDE.md"),
      path.join(projectRoot, "CLAUDE.md"),
      path.join(projectRoot, ".claude", "CLAUDE.md"),
      path.join(projectRoot, ".claude", "rules")
    ],
    agents: [path.join(home, ".claude", "agents"), path.join(projectRoot, ".claude", "agents")],
    plugins: [path.join(home, ".claude", "plugins"), path.join(projectRoot, ".claude", "plugins")]
  },
  codex: {
    skills: [path.join(home, ".codex", "skills"), path.join(home, ".agents", "skills"), path.join(projectRoot, ".codex", "skills")],
    mcp: [path.join(home, ".codex", "mcp"), path.join(projectRoot, ".codex", "mcp")],
    hooks: [path.join(home, ".codex", "hooks"), path.join(projectRoot, ".codex", "hooks")],
    rules: [
      path.join(home, ".codex", "rules"),
      path.join(home, ".codex", "AGENTS.md"),
      path.join(projectRoot, "AGENTS.md"),
      path.join(projectRoot, ".codex", "AGENTS.md"),
      path.join(projectRoot, ".codex", "rules")
    ],
    agents: [path.join(home, ".codex", "agents"), path.join(home, ".agents"), path.join(projectRoot, ".codex", "agents")],
    plugins: [path.join(home, ".codex", "plugins"), path.join(projectRoot, ".codex", "plugins")]
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
        items.push(pathItem(tool, category, childPath, sourcePath, true, undefined, validity, await contextForPath(childPath)));
      }
    } else {
      items.push(pathItem(tool, category, sourcePath, path.dirname(sourcePath), true, undefined, undefined, await contextForPath(sourcePath)));
    }
  }
  return items;
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
      rows.push(pathItem(meta.tool, meta.category, meta.originalPath, meta.source, false, meta.payloadPath, validity, await contextForPath(meta.payloadPath)));
    } catch {
      // Ignore malformed backup records; they are surfaced by filesystem inspection if restored manually.
    }
  }
  return rows;
}

const configSources = [
  { tool: "claude" as const, path: path.join(home, ".claude", "settings.json"), format: "json" as const },
  { tool: "claude" as const, path: path.join(projectRoot, ".claude", "settings.json"), format: "json" as const },
  { tool: "claude" as const, path: path.join(home, ".claude", ".cursor", "hooks.json"), format: "json" as const },
  { tool: "codex" as const, path: path.join(home, ".codex", "config.toml"), format: "toml" as const },
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
    (["claude", "codex"] as const).flatMap((tool) => (["skills", "mcp", "hooks", "rules", "agents", "plugins"] as const).map((category) => collectPathItems(tool, category)))
  );
  const disabledPathItems = await Promise.all((["claude", "codex"] as const).map(collectDisabledPathItems));
  const configItems = await collectConfigItems();
  const byId = new Map<string, InventoryItem>();
  [...activePathItems.flat(), ...disabledPathItems.flat(), ...configItems].forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort((a, b) => `${a.tool}-${a.category}-${a.name}`.localeCompare(`${b.tool}-${b.category}-${b.name}`));
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

function contextForText(text: string): ContextStats {
  const charsPerToken = 4;
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    estimatedTokens: text.length === 0 ? 0 : Math.ceil(text.length / charsPerToken),
    characters: text.length,
    bytes,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    metric: "approx_chars_per_token",
    charsPerToken
  };
}

function emptyContextStats(): ContextStats {
  return contextForText("");
}

export async function getDetail(id: string): Promise<ItemDetail | undefined> {
  const item = (await listInventory()).find((row) => row.id === id);
  if (!item) return undefined;
  if (item.kind === "config-entry") {
    const detail = item.enabled
      ? JSON.stringify(getAt(await readConfig(item.path!, item.path!.endsWith(".toml") ? "toml" : "json"), item.description.split(" in ")[0].split(".")), null, 2)
      : await safeRead(item.backupPath!);
    return { ...item, detail, detailType: "json" };
  }
  const target = item.enabled ? item.path! : item.backupPath!;
  const detail = await describePath(target);
  return { ...item, ...detail };
}

export async function toggleItem(id: string, enabled: boolean) {
  const item = (await listInventory()).find((row) => row.id === id);
  if (!item) throw new Error("Item not found");
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
    return (await listInventory()).find((row) => row.id === id);
  }

  const backupPath = path.join(backupHome[item.tool], "config", `${item.id}.json`);
  if (!enabled) {
    const configPath = item.path!;
    const format = configPath.endsWith(".toml") ? "toml" : "json";
    const data = await readConfig(configPath, format);
    const keyPath = item.description.split(" in ")[0].split(".");
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
  return (await listInventory()).find((row) => row.id === id);
}
