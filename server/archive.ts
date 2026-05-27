import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "smol-toml";
import { getAt, listInventory, readConfig, setAt } from "./discovery";
import type { ConfigEntryMeta, InventoryItem } from "./types";

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

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

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
  await runTar(["-czf", destPath, ...excludeArgs(), "-C", home, ...sources]);
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

    for (const item of selected) {
      if (item.kind === "path") {
        const sourcePath = item.enabled ? item.path : item.backupPath;
        if (!sourcePath) continue;
        if (!sourcePath.startsWith(home + path.sep) && sourcePath !== home) continue;
        const relative = path.relative(home, sourcePath);
        if (!relative || relative.startsWith("..")) continue;
        const destEntry = path.join(stagingDir, relative);
        await fs.mkdir(path.dirname(destEntry), { recursive: true });
        await fs.cp(sourcePath, destEntry, { recursive: true });
        continue;
      }

      // config-entry
      let configPath: string;
      let keyPath: string[];
      let value: unknown;
      if (item.enabled) {
        if (!item.path) continue;
        configPath = item.path;
        keyPath = item.description.split(" in ")[0].split(".");
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
    await runTar(["-czf", destPath, ...excludeArgs(), "-C", stagingDir, ...topLevel]);
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
