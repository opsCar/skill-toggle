import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listInventory } from "./discovery";
import { parseClaudeEnvelope } from "./diagnostics";
import { createProfile } from "./profiles";
import { exists, parseFrontmatterDescription, safeRead, walkFiles } from "./shared";
import type { AiProfileResult } from "./types";

// AI-assisted profile creation from a GitHub repo that contains skills.
//
// Design: the deterministic, mechanical work (clone, find every SKILL.md at any
// depth, install missing skills) runs in this Node module — reliable, handles
// arbitrarily-nested layouts (e.g. skills/<name>/SKILL.md in a mixed repo), and
// has no turn/permission limits. The `claude` CLI is used only for the
// judgement part: naming and describing the resulting profile. If the CLI is
// absent the install still works and we fall back to a derived name.
//
// SECURITY: the only external command run against the repo is `git clone
// --depth 1` into an isolated temp dir; installs are plain fs operations scoped
// to the three skill homes. The `claude` naming call uses no tools.

const execFileAsync = promisify(execFile);
const home = os.homedir();

// Resolve the three skill homes exactly as discovery.ts does (env overrides win).
const claudeSkillsDir = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"), "skills");
const codexSkillsDir = path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "skills");
const agentsSkillsDir = path.join(process.env.AGENTS_HOME ?? path.join(home, ".agents"), "skills");

const CLONE_TIMEOUT_MS = 3 * 60 * 1000;
const NAMING_TIMEOUT_MS = 60 * 1000;
const SKILL_SCAN_DEPTH = 8;

// Run a command with NO stdin (child gets EOF immediately, like `< /dev/null`),
// buffering stdout/stderr. Using spawn (not execFile) avoids the CLI blocking on
// an open stdin pipe.
function run(command: string, args: string[], opts: { cwd?: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      reject(Object.assign(new Error("timed out"), { timedOut: true }));
    }, opts.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export async function aiProfileCapabilities(): Promise<{ available: boolean; reason?: string }> {
  try {
    await execFileAsync("git", ["--version"], { timeout: 5000 });
    return { available: true };
  } catch {
    return { available: false, reason: "Requires `git` on PATH." };
  }
}

async function claudeAvailable(): Promise<boolean> {
  try {
    await execFileAsync("claude", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function normalizeRepoUrl(raw: unknown): string {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/.*)?$/i.test(url)) {
    throw Object.assign(new Error("Provide a GitHub repository URL like https://github.com/owner/repo"), { statusCode: 400 });
  }
  return url;
}

function ownerRepoLabel(url: string): string {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i);
  return match ? `${match[1]}/${match[2]}` : "GitHub skills";
}

interface DiscoveredSkill {
  name: string; // directory basename — matches how discovery.ts labels the item
  dir: string; // absolute path to the skill directory inside the clone
  description?: string;
}

// A valid skill is a directory with a SKILL.md whose YAML frontmatter declares
// both `name` and `description` (mirrors discovery.validateSkill).
async function readSkillManifest(skillMdPath: string): Promise<{ valid: boolean; description?: string }> {
  const content = await safeRead(skillMdPath);
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return { valid: false };
  const block = frontmatter[1];
  const hasField = (field: string) => new RegExp(`^${field}:\\s*(\\S|[|>])`, "m").test(block);
  if (!hasField("name") || !hasField("description")) return { valid: false };
  return { valid: true, description: parseFrontmatterDescription(content) };
}

// Recursively find every skill in the clone: any SKILL.md (at any depth) whose
// parent directory is a valid skill. Skips VCS/dependency noise and de-dupes by
// skill name (directory basename).
async function discoverSkills(repoDir: string, warnings: string[]): Promise<DiscoveredSkill[]> {
  const manifests = (await walkFiles(repoDir, SKILL_SCAN_DEPTH, (name) => name.toLowerCase() === "skill.md")).filter(
    (file) => !/(^|\/)(\.git|node_modules)\//.test(file)
  );
  const byName = new Map<string, DiscoveredSkill>();
  for (const manifest of manifests) {
    const dir = path.dirname(manifest);
    const name = path.basename(dir);
    const meta = await readSkillManifest(manifest);
    if (!meta.valid) {
      warnings.push(`Skipped ${path.relative(repoDir, dir)} — SKILL.md is missing required frontmatter (name/description).`);
      continue;
    }
    if (byName.has(name)) {
      warnings.push(`Skipped duplicate skill name "${name}" at ${path.relative(repoDir, dir)}.`);
      continue;
    }
    byName.set(name, { name, dir, description: meta.description });
  }
  return [...byName.values()];
}

// Install one skill: real copy in the agents home, symlinks in the claude/codex
// homes. Idempotent — an existing agents copy means it's already installed.
async function installSkill(skill: DiscoveredSkill): Promise<"installed" | "alreadyPresent"> {
  const agentsTarget = path.join(agentsSkillsDir, skill.name);
  if (await exists(agentsTarget)) return "alreadyPresent";
  await fs.mkdir(agentsSkillsDir, { recursive: true });
  await fs.cp(skill.dir, agentsTarget, { recursive: true });
  for (const dir of [claudeSkillsDir, codexSkillsDir]) {
    await fs.mkdir(dir, { recursive: true });
    const link = path.join(dir, skill.name);
    if (!(await exists(link))) await fs.symlink(agentsTarget, link, "dir");
  }
  return "installed";
}

// Best-effort: ask the `claude` CLI to name/describe the profile from the skill
// list. Pure text (no tools). Never throws — returns {} on any failure.
async function nameProfile(
  url: string,
  skills: DiscoveredSkill[]
): Promise<{ name?: string; description?: string; trace: AiProfileResult["llm"] }> {
  const catalog = skills.map((skill) => `- ${skill.name}: ${skill.description ?? ""}`).join("\n");
  const prompt = `You are naming a Claude Code "profile" that bundles the skills below (installed from ${url}). Reply with ONLY a JSON object, no prose, no code fences: {"profileName": "<friendly name, <= 40 chars>", "profileDescription": "<one sentence>"}\n\nSkills:\n${catalog}`;
  const trace: AiProfileResult["llm"] = { prompt, response: "" };
  if (skills.length === 0 || !(await claudeAvailable())) {
    trace.response = "(skipped — using a derived name)";
    return { trace };
  }
  try {
    const result = await run("claude", ["-p", prompt, "--output-format", "json", "--max-turns", "2"], { timeoutMs: NAMING_TIMEOUT_MS });
    const envelope = parseClaudeEnvelope(result.stdout);
    trace.response = envelope.text;
    if (envelope.usage) {
      trace.usage = {
        inputTokens: envelope.usage.inputTokens,
        outputTokens: envelope.usage.outputTokens,
        costUsd: envelope.usage.costUsd,
        durationMs: envelope.usage.durationMs
      };
    }
    const match = envelope.text.match(/\{[\s\S]*\}/);
    if (!match) return { trace };
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    return { name: str(parsed.profileName), description: str(parsed.profileDescription), trace };
  } catch (err) {
    trace.response = `(naming skipped: ${err instanceof Error ? err.message : String(err)})`;
    return { trace };
  }
}

export async function createProfileFromRepo(input: { url: unknown }): Promise<AiProfileResult> {
  const url = normalizeRepoUrl(input.url);
  const cap = await aiProfileCapabilities();
  if (!cap.available) throw Object.assign(new Error(cap.reason ?? "`git` is not available."), { statusCode: 503 });

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-ai-"));
  const repoDir = path.join(workdir, "repo");
  const warnings: string[] = [];

  try {
    // 1. Clone.
    try {
      const clone = await run("git", ["clone", "--depth", "1", url, repoDir], { timeoutMs: CLONE_TIMEOUT_MS });
      if (clone.code !== 0) {
        const detail = clone.stderr.trim() || `git exited with code ${clone.code ?? "unknown"}`;
        throw Object.assign(new Error(`Could not clone the repository: ${detail}`), { statusCode: 502 });
      }
    } catch (err) {
      if (typeof err === "object" && err && "statusCode" in err) throw err;
      const anyErr = err as { timedOut?: boolean; message?: string };
      throw Object.assign(new Error(`Could not clone the repository: ${anyErr.timedOut ? "timed out" : anyErr.message ?? String(err)}`), { statusCode: 502 });
    }

    // 2. Discover every skill (any depth).
    const skills = await discoverSkills(repoDir, warnings);
    if (skills.length === 0) {
      warnings.push("No skills (a directory with a valid SKILL.md) were found anywhere in the repository.");
    }

    // 3. Install (deterministic; per-skill errors are collected, not fatal).
    const installed: string[] = [];
    const alreadyPresent: string[] = [];
    for (const skill of skills) {
      try {
        const outcome = await installSkill(skill);
        (outcome === "installed" ? installed : alreadyPresent).push(skill.name);
      } catch (err) {
        warnings.push(`Failed to install "${skill.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. Name/describe the profile (best-effort LLM).
    const naming = await nameProfile(url, skills);

    // 5. Resolve installed skills to inventory ids across all three tools, and
    // keep the rest of the harness on by whitelisting currently-enabled
    // non-skill governable items alongside them.
    const inventory = await listInventory();
    const wanted = new Set([...installed, ...alreadyPresent].map((name) => name.toLowerCase()));
    const skillItems = inventory.filter(
      (item) => item.category === "skills" && item.kind !== "session-derived" && wanted.has(item.name.toLowerCase())
    );
    const foundNames = new Set(skillItems.map((item) => item.name.toLowerCase()));
    const undetected = [...wanted].filter((name) => !foundNames.has(name));
    if (undetected.length > 0) warnings.push(`Installed but not detected in the inventory: ${undetected.join(", ")}.`);

    const harnessIds = inventory
      .filter((item) => item.enabled && item.kind !== "session-derived" && item.category !== "skills")
      .map((item) => item.id);
    const enabledIds = [...new Set([...skillItems.map((item) => item.id), ...harnessIds])];

    const label = ownerRepoLabel(url);
    const profile = await createProfile({
      name: naming.name ?? `${label} skills`,
      description: naming.description ?? `Skills from ${url}, with the current harness left on.`,
      enabledIds
    });

    return {
      profile,
      skills: skills.map((skill) => skill.name),
      installed,
      alreadyPresent,
      warnings,
      llm: naming.trace
    };
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}
