import { constants, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type ItemCategory = "skills" | "mcp" | "hooks" | "rules";
export type ItemSource = "claude" | "codex";

export type InventoryItem = {
  id: string;
  name: string;
  source: ItemSource;
  category: ItemCategory;
  enabled: boolean;
  kind: "file" | "directory";
  activePath: string;
  backupPath: string;
  currentPath: string;
  description?: string;
  detailAvailable: boolean;
};

export type DetailResponse = {
  id: string;
  title: string;
  path: string;
  description?: string;
  content: string;
  contentType: "markdown" | "text" | "json" | "toml" | "yaml";
};

type RootInfo = {
  source: ItemSource;
  activeRoot: string;
  backupRoot: string;
};

type Candidate = {
  source: ItemSource;
  category: ItemCategory;
  activePath: string;
  backupPath: string;
};

const home = os.homedir();

export const roots: Record<ItemSource, RootInfo> = {
  claude: {
    source: "claude",
    activeRoot: path.join(home, ".claude"),
    backupRoot: path.join(home, ".claude_bak")
  },
  codex: {
    source: "codex",
    activeRoot: path.join(home, ".codex"),
    backupRoot: path.join(home, ".codex_bak")
  }
};

const detailFileNames = ["README.md", "SKILL.md", "AGENTS.md", "CLAUDE.md", "description.md"];
const readableExtensions = new Set([".md", ".txt", ".json", ".toml", ".yaml", ".yml"]);

export function encodeId(source: ItemSource, category: ItemCategory, activePath: string) {
  return Buffer.from(JSON.stringify({ source, category, activePath })).toString("base64url");
}

export function decodeId(id: string): { source: ItemSource; category: ItemCategory; activePath: string } {
  const parsed = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as {
    source?: unknown;
    category?: unknown;
    activePath?: unknown;
  };
  if ((parsed.source !== "claude" && parsed.source !== "codex") || typeof parsed.activePath !== "string") {
    throw new Error("Invalid item id");
  }
  if (!["skills", "mcp", "hooks", "rules"].includes(String(parsed.category))) {
    throw new Error("Invalid item category");
  }
  return parsed as { source: ItemSource; category: ItemCategory; activePath: string };
}

export async function listInventory(): Promise<InventoryItem[]> {
  const candidates = await discoverCandidates();
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    unique.set(encodeId(candidate.source, candidate.category, candidate.activePath), candidate);
  }

  const items: Array<InventoryItem | null> = await Promise.all(
    [...unique.values()].map(async (candidate) => {
      const activeExists = await exists(candidate.activePath);
      const backupExists = await exists(candidate.backupPath);
      if (!activeExists && !backupExists) return null;
      const currentPath = activeExists ? candidate.activePath : candidate.backupPath;
      const stat = await fs.stat(currentPath);
      const description = await readDescription(currentPath, stat.isDirectory());
      const detailAvailable = await hasDetail(currentPath, stat.isDirectory());
      const item: InventoryItem = {
        id: encodeId(candidate.source, candidate.category, candidate.activePath),
        name: displayName(candidate.activePath, candidate.category),
        source: candidate.source,
        category: candidate.category,
        enabled: activeExists,
        kind: stat.isDirectory() ? "directory" : "file",
        activePath: candidate.activePath,
        backupPath: candidate.backupPath,
        currentPath,
        description,
        detailAvailable
      };
      return item;
    })
  );

  return items
    .filter((item): item is InventoryItem => item !== null)
    .sort((a, b) => `${a.source}:${a.category}:${a.name}`.localeCompare(`${b.source}:${b.category}:${b.name}`));
}

export async function getDetail(id: string): Promise<DetailResponse> {
  const item = await getItem(id);
  const stat = await fs.stat(item.currentPath);
  const detailPath = await findDetailPath(item.currentPath, stat.isDirectory());
  const content = detailPath ? await fs.readFile(detailPath, "utf8") : item.description ?? "No README, SKILL.md, or readable detail file found.";
  return {
    id,
    title: detailPath ? path.basename(detailPath) : item.name,
    path: detailPath ?? item.currentPath,
    description: item.description,
    content,
    contentType: contentType(detailPath ?? item.currentPath)
  };
}

export async function setEnabled(id: string, enabled: boolean): Promise<InventoryItem> {
  const decoded = decodeId(id);
  const root = roots[decoded.source];
  const activePath = normalizeInside(decoded.activePath, root.activeRoot);
  const backupPath = backupPathFor(root, activePath);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });

  const activeExists = await exists(activePath);
  const backupExists = await exists(backupPath);

  if (enabled) {
    if (!activeExists && !backupExists) throw new Error("Cannot enable item because no backup exists");
    if (!activeExists) await movePath(backupPath, activePath);
  } else {
    if (!activeExists) return getItem(id);
    if (backupExists) {
      const suffix = new Date().toISOString().replace(/[:.]/g, "-");
      await movePath(activePath, `${backupPath}.${suffix}`);
    } else {
      await movePath(activePath, backupPath);
    }
  }

  return getItem(id);
}

async function discoverCandidates(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const root of Object.values(roots)) {
    candidates.push(...(await discoverSkills(root)));
    candidates.push(...(await discoverConfigFiles(root, "mcp", mcpFiles(root))));
    candidates.push(...(await discoverConfigFiles(root, "hooks", hookFiles(root))));
    candidates.push(...(await discoverConfigFiles(root, "rules", ruleFiles(root))));
    candidates.push(...(await discoverBackups(root)));
  }
  return candidates;
}

async function discoverSkills(root: RootInfo): Promise<Candidate[]> {
  const skillsRoot = path.join(root.activeRoot, "skills");
  const backupSkillsRoot = path.join(root.backupRoot, "skills");
  const candidates: Candidate[] = [];
  for (const base of [skillsRoot, backupSkillsRoot]) {
    for (const entry of await listDirs(base)) {
      const activePath = path.join(skillsRoot, path.basename(entry));
      candidates.push({ source: root.source, category: "skills", activePath, backupPath: backupPathFor(root, activePath) });
    }
  }
  return candidates;
}

async function discoverConfigFiles(root: RootInfo, category: ItemCategory, files: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const file of files) {
    const activePath = path.join(root.activeRoot, file);
    const backupPath = backupPathFor(root, activePath);
    if ((await exists(activePath)) || (await exists(backupPath))) {
      candidates.push({ source: root.source, category, activePath, backupPath });
    }
  }
  return candidates;
}

async function discoverBackups(root: RootInfo): Promise<Candidate[]> {
  const files = await walk(root.backupRoot, 4);
  return files.map((backupFile) => {
    const relative = path.relative(root.backupRoot, backupFile);
    const activePath = path.join(root.activeRoot, relative);
    return {
      source: root.source,
      category: inferCategory(relative),
      activePath,
      backupPath: backupFile
    };
  });
}

function mcpFiles(root: RootInfo) {
  const common = ["mcp.json", "mcp-needs-auth-cache.json", "settings.json", "config.toml"];
  if (root.source === "claude") return [...common, ".codex/config.toml", ".cursor/mcp.json"];
  return [...common, "AGENTS.md"];
}

function hookFiles(root: RootInfo) {
  const common = ["settings.json", "hooks.json", ".cursor/hooks.json"];
  if (root.source === "claude") return common;
  return [...common, "config.toml"];
}

function ruleFiles(root: RootInfo) {
  const common = ["AGENTS.md", "CLAUDE.md", "settings.json"];
  if (root.source === "claude") return [...common, "commands", ".codex/AGENTS.md"];
  return [...common, "instructions.md", "config.toml"];
}

function inferCategory(relative: string): ItemCategory {
  if (relative.startsWith("skills/")) return "skills";
  if (relative.includes("hook")) return "hooks";
  if (relative.includes("mcp")) return "mcp";
  return "rules";
}

function backupPathFor(root: RootInfo, activePath: string) {
  const relative = path.relative(root.activeRoot, activePath);
  if (relative.startsWith("..")) throw new Error("Path is outside active root");
  return path.join(root.backupRoot, relative);
}

function normalizeInside(target: string, root: string) {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside ${resolvedRoot}`);
  }
  return resolvedTarget;
}

async function getItem(id: string) {
  const items = await listInventory();
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Item not found");
  return item;
}

async function movePath(from: string, to: string) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EXDEV") throw error;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

async function exists(target: string) {
  try {
    await fs.access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(target: string) {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(target, entry.name));
  } catch {
    return [];
  }
}

async function walk(target: string, depth: number): Promise<string[]> {
  if (depth < 0 || !(await exists(target))) return [];
  const entries = await fs.readdir(target, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, depth - 1)));
    else out.push(full);
  }
  return out;
}

async function readDescription(target: string, isDirectory: boolean) {
  const detailPath = await findDetailPath(target, isDirectory);
  if (!detailPath) return undefined;
  const content = await fs.readFile(detailPath, "utf8");
  const frontMatterDescription = content.match(/^---\n[\s\S]*?\ndescription:\s*['"]?(.+?)['"]?\n[\s\S]*?\n---/m)?.[1];
  if (frontMatterDescription) return frontMatterDescription.trim();
  const paragraph = content
    .replace(/^---[\s\S]*?---/, "")
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s+/gm, "").trim())
    .find((part) => part.length > 20);
  return paragraph?.slice(0, 260);
}

async function hasDetail(target: string, isDirectory: boolean) {
  return (await findDetailPath(target, isDirectory)) !== null;
}

async function findDetailPath(target: string, isDirectory: boolean): Promise<string | null> {
  if (isDirectory) {
    for (const fileName of detailFileNames) {
      const candidate = path.join(target, fileName);
      if (await exists(candidate)) return candidate;
    }
    return null;
  }
  return readableExtensions.has(path.extname(target)) ? target : null;
}

function displayName(activePath: string, category: ItemCategory) {
  if (category === "skills") return path.basename(activePath);
  return path.relative(path.dirname(path.dirname(activePath)), activePath);
}

function contentType(target: string): DetailResponse["contentType"] {
  const extension = path.extname(target);
  if (extension === ".md") return "markdown";
  if (extension === ".json") return "json";
  if (extension === ".toml") return "toml";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  return "text";
}
