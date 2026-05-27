import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

export async function writeExportArchive(destPath: string): Promise<ExportSummary> {
  const sources = await existingSources();
  if (sources.length === 0) throw new Error("Nothing to export: ~/.claude and ~/.codex are both missing");
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await runTar(["-czf", destPath, ...excludeArgs(), "-C", home, ...sources]);
  const stat = await fs.stat(destPath);
  return { filename: path.basename(destPath), bytes: stat.size, sources };
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
