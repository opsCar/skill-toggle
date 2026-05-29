import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import { getAt, listInventory, readConfig, setAt } from "./discovery";
import type { Category, ConfigEntryMeta, InventoryItem, ToolName } from "./types";
import { contextForText, emptyContextStats, exists } from "./shared";

const home = os.homedir();

// Reusable "config-only" tar exclusions. Everything here is rebuildable on
// the destination machine or is private conversation/log data that must not
// travel with a portable env.
const EXCLUDES = [
  // Rebuildable
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".git",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".DS_Store",
  "*.pyc",
  // Logs / databases / caches
  "*.log",
  "*.sqlite",
  "*.sqlite-shm",
  "*.sqlite-wal",
  "__store.db",
  "cache",
  "statsig",
  "telemetry",
  // Claude private state
  "projects",
  "file-history",
  "shell-snapshots",
  "tasks",
  "backups",
  // Codex private state
  "sessions",
  "shell_snapshots",
  "computer-use",
  "logs_*",
  "state_*"
];

// Top-level entries (relative to $HOME) that the archive can include. We
// only ship what exists at export time, so a clean machine produces a
// smaller archive without errors.
export const ARCHIVE_SOURCES = [".claude", ".codex", ".claude_bak", ".codex_bak"] as const;
const ALLOWED_SOURCES = new Set<string>(ARCHIVE_SOURCES);

const BACKUP_ROOT = path.join(home, ".skill-toggle-backups");

export type ExportSummary = {
  filename: string;
  bytes: number;
  sources: string[];
};

export type ImportSummary = {
  preImportBackup: string;
  restoredSources: string[];
};

export type ArchiveImportItem = InventoryItem & {
  archivePath: string;
  destinationPath: string;
  keyPath?: string[];
};

export type ImportInspection = {
  sources: string[];
  items: ArchiveImportItem[];
};

export type AppendImportSummary = {
  appendedItems: string[];
  restoredSources: string[];
};

async function existingSources(): Promise<string[]> {
  const found: string[] = [];
  for (const source of ARCHIVE_SOURCES) {
    if (await exists(path.join(home, source))) found.push(source);
  }
  return found;
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${stderr.trim() || "no stderr"}`));
    });
  });
}

function excludeArgs() {
  return EXCLUDES.flatMap((pattern) => ["--exclude", pattern]);
}

export async function writeExportArchive(destPath: string, itemIds?: string[]): Promise<ExportSummary> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  if (itemIds !== undefined) {
    return writeSelectiveExport(destPath, itemIds);
  }
  const sources = await existingSources();
  if (sources.length === 0) throw new Error("Nothing to export: ~/.claude and ~/.codex are both missing");
  // -h dereferences symlinks so a skill symlinked from a sibling working copy
  // ships as real files instead of dangling on the recipient machine.
  await runTar(["-czhf", destPath, ...excludeArgs(), "-C", home, ...sources]);
  const stat = await fs.stat(destPath);
  return { filename: path.basename(destPath), bytes: stat.size, sources };
}

async function writeSelectiveExport(destPath: string, itemIds: string[]): Promise<ExportSummary> {
  if (itemIds.length === 0) throw new Error("Nothing to export: no items selected");
  const selectedSet = new Set(itemIds);
  const inventory = await listInventory();
  const selected: InventoryItem[] = inventory.filter((item) => selectedSet.has(item.id));
  if (selected.length === 0) throw new Error("Nothing to export: selected items not found in inventory");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stagingDir = path.join(os.tmpdir(), `skill-toggle-staging-${stamp}`);
  await fs.mkdir(stagingDir, { recursive: true });
  try {
    type ConfigBucket = { format: "json" | "toml"; data: any; configPath: string };
    const configBuckets = new Map<string, ConfigBucket>();

    const skipped: string[] = [];
    for (const item of selected) {
      if (item.kind === "path") {
        const sourcePath = item.enabled ? item.path : item.backupPath;
        if (!sourcePath) continue;
        if (!sourcePath.startsWith(home + path.sep) && sourcePath !== home) continue;
        const relative = path.relative(home, sourcePath);
        if (!relative || relative.startsWith("..")) continue;
        const destEntry = path.join(stagingDir, relative);
        await fs.mkdir(path.dirname(destEntry), { recursive: true });
        // dereference: follow symlinks so the archive ships real files. Skills
        // are often symlinked from a sibling working copy (e.g. ~/.claude/skills/gstack
        // → ~/code/gstack); shipping the link alone would dangle on the recipient.
        try {
          await fs.cp(sourcePath, destEntry, { recursive: true, dereference: true });
        } catch (err) {
          const reason = `${sourcePath} (${(err as NodeJS.ErrnoException).code ?? "error"})`;
          skipped.push(reason);
          console.warn(`[export] skipping ${reason}`);
          await fs.rm(destEntry, { recursive: true, force: true }).catch(() => undefined);
        }
        continue;
      }

      // config-entry
      let configPath: string;
      let keyPath: string[];
      let value: unknown;
      if (item.enabled) {
        if (!item.path) continue;
        configPath = item.path;
        keyPath = item.keyPath && item.keyPath.length > 0 ? item.keyPath : item.description.split(" in ")[0].split(".");
        const format: "json" | "toml" = configPath.endsWith(".toml") ? "toml" : "json";
        const live = await readConfig(configPath, format);
        value = getAt(live, keyPath);
      } else {
        if (!item.backupPath) continue;
        const metaText = await fs.readFile(item.backupPath, "utf8").catch(() => "");
        if (!metaText) continue;
        const meta = JSON.parse(metaText) as ConfigEntryMeta;
        configPath = meta.configPath;
        keyPath = meta.keyPath;
        value = meta.value;
      }
      if (!configPath.startsWith(home + path.sep)) continue;
      const format: "json" | "toml" = configPath.endsWith(".toml") ? "toml" : "json";
      let bucket = configBuckets.get(configPath);
      if (!bucket) {
        bucket = { format, data: {}, configPath };
        configBuckets.set(configPath, bucket);
      }
      setAt(bucket.data, keyPath, value);
    }

    for (const bucket of configBuckets.values()) {
      const relative = path.relative(home, bucket.configPath);
      if (!relative || relative.startsWith("..")) continue;
      const destEntry = path.join(stagingDir, relative);
      await fs.mkdir(path.dirname(destEntry), { recursive: true });
      const text = bucket.format === "json" ? `${JSON.stringify(bucket.data, null, 2)}\n` : stringify(bucket.data as any);
      await fs.writeFile(destEntry, text);
    }

    const topLevel = (await fs.readdir(stagingDir)).filter((entry) => ALLOWED_SOURCES.has(entry as typeof ARCHIVE_SOURCES[number]));
    if (topLevel.length === 0) throw new Error("Nothing staged for export: selection produced no archivable files");
    await runTar(["-czhf", destPath, ...excludeArgs(), "-C", stagingDir, ...topLevel]);
    const stat = await fs.stat(destPath);
    return { filename: path.basename(destPath), bytes: stat.size, sources: topLevel };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function applyImportArchive(tarPath: string): Promise<ImportSummary> {
  // 1. Verify the incoming archive lists only paths we are willing to touch.
  const entries = await listTarTopLevel(tarPath);
  const unexpected = entries.filter((entry) => !ALLOWED_SOURCES.has(entry));
  if (unexpected.length > 0) {
    throw new Error(`Refusing import: archive contains unexpected top-level entries: ${unexpected.join(", ")}`);
  }
  if (entries.length === 0) {
    throw new Error("Refusing import: archive is empty or has no recognized top-level directories");
  }

  // 2. Snapshot current env to a timestamped backup tar before mutating anything.
  await fs.mkdir(BACKUP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preImportBackup = path.join(BACKUP_ROOT, `pre-import-${stamp}.tar.gz`);
  const currentSources = await existingSources();
  if (currentSources.length > 0) {
    await runTar(["-czf", preImportBackup, ...excludeArgs(), "-C", home, ...currentSources]);
  } else {
    // No live env to back up. Still create a marker so the caller has a path
    // to surface to the user.
    await fs.writeFile(preImportBackup, Buffer.alloc(0));
  }

  // 3. Move the dirs the archive will replace into a side location so a
  //    failed extract can be rolled back atomically.
  const sideDir = path.join(home, `.skill-toggle-stash-${stamp}`);
  await fs.mkdir(sideDir);
  const stashed: string[] = [];
  try {
    for (const source of entries) {
      const live = path.join(home, source);
      if (await exists(live)) {
        await fs.rename(live, path.join(sideDir, source));
        stashed.push(source);
      }
    }
    await runTar(["-xzf", tarPath, "-C", home]);
  } catch (err) {
    for (const source of stashed) {
      await fs.rm(path.join(home, source), { recursive: true, force: true });
      await fs.rename(path.join(sideDir, source), path.join(home, source)).catch(() => undefined);
    }
    await fs.rm(sideDir, { recursive: true, force: true });
    throw err;
  }
  await fs.rm(sideDir, { recursive: true, force: true });

  return { preImportBackup, restoredSources: entries };
}

export async function inspectImportArchive(tarPath: string): Promise<ImportInspection> {
  const entries = await validateArchive(tarPath);
  const stagingDir = path.join(os.tmpdir(), `skill-toggle-inspect-${Date.now()}-${process.pid}`);
  await fs.mkdir(stagingDir, { recursive: true });
  try {
    await runTar(["-xzf", tarPath, "-C", stagingDir]);
    return { sources: entries, items: await listArchiveInventory(stagingDir) };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function appendImportArchive(tarPath: string, itemIds: string[]): Promise<AppendImportSummary> {
  if (itemIds.length === 0) throw new Error("Nothing to append: no archive items selected");
  const entries = await validateArchive(tarPath);
  const stagingDir = path.join(os.tmpdir(), `skill-toggle-append-${Date.now()}-${process.pid}`);
  await fs.mkdir(stagingDir, { recursive: true });
  try {
    await runTar(["-xzf", tarPath, "-C", stagingDir]);
    const available = await listArchiveInventory(stagingDir);
    const selectedSet = new Set(itemIds);
    const selected = available.filter((item) => selectedSet.has(item.id));
    if (selected.length === 0) throw new Error("Nothing to append: selected archive items were not found");

    const conflicts: ArchiveImportItem[] = [];
    for (const item of selected) {
      if (item.kind === "path" && item.destinationPath && await exists(item.destinationPath)) {
        conflicts.push(item);
        continue;
      }
      if (item.kind === "config-entry") {
        const keyPath = item.keyPath ?? item.description.split(" in ")[0].split(".");
        const format = item.destinationPath.endsWith(".toml") ? "toml" : "json";
        const currentData = await readConfig(item.destinationPath, format);
        if (getAt(currentData, keyPath) !== undefined) conflicts.push(item);
      }
    }
    if (conflicts.length > 0) {
      throw new Error(`Append would overwrite existing items: ${conflicts.map((item) => item.description).join(", ")}`);
    }

    const appended: string[] = [];
    for (const item of selected) {
      if (item.kind === "path") {
        const sourcePath = path.join(stagingDir, item.archivePath);
        await fs.mkdir(path.dirname(item.destinationPath), { recursive: true });
        await fs.cp(sourcePath, item.destinationPath, { recursive: true });
        appended.push(item.name);
        continue;
      }

      const sourceConfig = path.join(stagingDir, item.archivePath);
      const keyPath = item.keyPath ?? item.description.split(" in ")[0].split(".");
      const format = item.destinationPath.endsWith(".toml") ? "toml" : "json";
      const importedData = await readArchiveConfig(sourceConfig, format);
      const importedValue = getAt(importedData, keyPath);
      const currentData = await readConfig(item.destinationPath, format);
      setAt(currentData, keyPath, importedValue);
      await fs.mkdir(path.dirname(item.destinationPath), { recursive: true });
      const text = format === "json" ? `${JSON.stringify(currentData, null, 2)}\n` : stringify(currentData as any);
      await fs.writeFile(item.destinationPath, text);
      appended.push(item.name);
    }

    return { appendedItems: appended, restoredSources: entries };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function validateArchive(tarPath: string): Promise<string[]> {
  const entries = await listTarTopLevel(tarPath);
  const unexpected = entries.filter((entry) => !ALLOWED_SOURCES.has(entry));
  if (unexpected.length > 0) {
    throw new Error(`Refusing import: archive contains unexpected top-level entries: ${unexpected.join(", ")}`);
  }
  if (entries.length === 0) {
    throw new Error("Refusing import: archive is empty or has no recognized top-level directories");
  }
  return entries;
}

async function listArchiveInventory(root: string): Promise<ArchiveImportItem[]> {
  const items: ArchiveImportItem[] = [];
  await collectArchivePathItems(root, items);
  await collectArchiveConfigItems(root, items);
  return items.sort((a, b) => `${a.tool}-${a.category}-${a.name}`.localeCompare(`${b.tool}-${b.category}-${b.name}`));
}

async function collectArchivePathItems(root: string, items: ArchiveImportItem[]) {
  const sourceDefs: Array<{ tool: ToolName; category: Category; rel: string; single?: boolean }> = [
    { tool: "claude", category: "skills", rel: ".claude/skills" },
    { tool: "claude", category: "skills", rel: ".claude/.cursor/skills" },
    { tool: "claude", category: "mcp", rel: ".claude/mcp" },
    { tool: "claude", category: "hooks", rel: ".claude/hooks" },
    { tool: "claude", category: "hooks", rel: ".claude/.cursor/hooks" },
    { tool: "claude", category: "rules", rel: ".claude/rules" },
    { tool: "claude", category: "rules", rel: ".claude/CLAUDE.md", single: true },
    { tool: "claude", category: "agents", rel: ".claude/agents" },
    { tool: "claude", category: "plugins", rel: ".claude/plugins" },
    { tool: "codex", category: "skills", rel: ".codex/skills" },
    { tool: "codex", category: "agents", rel: ".codex/agents" },
    { tool: "codex", category: "agents", rel: ".agents" },
    { tool: "codex", category: "mcp", rel: ".codex/mcp" },
    { tool: "codex", category: "hooks", rel: ".codex/hooks" },
    { tool: "codex", category: "rules", rel: ".codex/rules" },
    { tool: "codex", category: "rules", rel: ".codex/AGENTS.md", single: true },
    { tool: "codex", category: "plugins", rel: ".codex/plugins" }
  ];

  for (const source of sourceDefs) {
    const sourcePath = path.join(root, source.rel);
    if (!(await exists(sourcePath))) continue;
    const stat = await fs.stat(sourcePath);
    if (source.single || !stat.isDirectory()) {
      items.push(makeArchivePathItem(source.tool, source.category, source.rel, path.dirname(source.rel), source.rel));
      continue;
    }
    for (const child of await fs.readdir(sourcePath, { withFileTypes: true })) {
      if (child.name.startsWith(".")) continue;
      const rel = path.posix.join(source.rel, child.name);
      items.push(makeArchivePathItem(source.tool, source.category, rel, source.rel, rel));
    }
  }
}

async function collectArchiveConfigItems(root: string, items: ArchiveImportItem[]) {
  const configs = [
    { tool: "claude" as const, rel: ".claude/settings.json", format: "json" as const },
    { tool: "claude" as const, rel: ".claude/.cursor/hooks.json", format: "json" as const },
    { tool: "codex" as const, rel: ".codex/config.toml", format: "toml" as const }
  ];
  for (const config of configs) {
    const configPath = path.join(root, config.rel);
    if (!(await exists(configPath))) continue;
    const data = await readArchiveConfig(configPath, config.format);
    const entries = configuredArchiveEntries(config.tool, config.rel, data);
    items.push(...entries);
  }
}

function configuredArchiveEntries(tool: ToolName, archivePath: string, data: any): ArchiveImportItem[] {
  const entries: Array<{ category: Category; keyPath: string[]; value: unknown }> = [];
  const mcpRoot = tool === "codex" ? data.mcp_servers : data.mcpServers;
  if (mcpRoot && typeof mcpRoot === "object") {
    for (const key of Object.keys(mcpRoot)) entries.push({ category: "mcp", keyPath: [tool === "codex" ? "mcp_servers" : "mcpServers", key], value: mcpRoot[key] });
  }
  const hooksRoot = data.hooks;
  if (hooksRoot && typeof hooksRoot === "object") {
    for (const key of Object.keys(hooksRoot)) entries.push({ category: "hooks", keyPath: ["hooks", key], value: hooksRoot[key] });
  }
  return entries.map((entry) => makeArchiveConfigItem(tool, entry.category, archivePath, entry.keyPath, entry.value));
}

function makeArchivePathItem(tool: ToolName, category: Category, archivePath: string, source: string, identityPath: string): ArchiveImportItem {
  const destinationPath = path.join(home, archivePath);
  const name = labelFromPath(identityPath);
  return {
    id: archiveItemId({ kind: "path", archivePath }),
    tool,
    category,
    kind: "path",
    name,
    enabled: false,
    description: destinationPath,
    source,
    path: destinationPath,
    archivePath,
    destinationPath,
    builtin: false,
    detailAvailable: false,
    valid: true,
    context: emptyContextStats()
  };
}

function makeArchiveConfigItem(tool: ToolName, category: Category, archivePath: string, keyPath: string[], value: unknown): ArchiveImportItem {
  const destinationPath = path.join(home, archivePath);
  const name = keyPath[keyPath.length - 1] || labelFromPath(archivePath);
  return {
    id: archiveItemId({ kind: "config-entry", archivePath, keyPath }),
    tool,
    category,
    kind: "config-entry",
    name,
    enabled: false,
    description: `${keyPath.join(".")} in ${destinationPath}`,
    source: archivePath,
    path: destinationPath,
    archivePath,
    destinationPath,
    keyPath,
    builtin: false,
    detailAvailable: false,
    valid: true,
    context: contextForText(JSON.stringify(value, null, 2))
  };
}

function archiveItemId(value: unknown) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function labelFromPath(target: string) {
  const base = path.basename(target);
  return base.replace(/\.(md|json|toml|yaml|yml|js|ts|mjs|cjs)$/i, "");
}

async function readArchiveConfig(configPath: string, format: "json" | "toml") {
  const text = await fs.readFile(configPath, "utf8").catch(() => "");
  if (!text.trim()) return {};
  try {
    return format === "json" ? JSON.parse(text) : parse(text);
  } catch {
    return {};
  }
}

async function listTarTopLevel(tarPath: string): Promise<string[]> {
  const stdout = await runTarStdout(["-tzf", tarPath]);
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\.\//, "");
    if (!trimmed) continue;
    const top = trimmed.split("/")[0];
    if (top) seen.add(top);
  }
  return [...seen];
}

function runTarStdout(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`tar exited ${code}: ${stderr.trim() || "no stderr"}`));
    });
  });
}
