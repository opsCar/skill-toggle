import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parse as parseToml } from "smol-toml";
import type { Category, Provider, RegistryDetail, RegistryItem, RegistryRoots, Scope } from "./registry-types";

const TEXT_LIMIT = 24_000;

export function defaultRoots(): RegistryRoots {
  return {
    projectRoot: process.env.SKILL_TOGGLE_PROJECT_ROOT ?? process.cwd(),
    homeDir: process.env.SKILL_TOGGLE_HOME ?? os.homedir()
  };
}

export async function listItems(roots = defaultRoots()): Promise<RegistryItem[]> {
  const items = [
    ...(await scanSkills(roots)),
    ...(await scanDirectoryItems(roots, "agent", "agents", "Agent definition")),
    ...(await scanDirectoryItems(roots, "plugin", "plugins", "Plugin bundle")),
    ...(await scanRules(roots)),
    ...(await scanClaudeSettings(roots)),
    ...(await scanCodexConfig(roots)),
    ...(await scanDisabled(roots))
  ];

  const deduped = new Map<string, RegistryItem>();
  for (const item of items) {
    deduped.set(item.id, item);
  }

  return [...deduped.values()].sort((a, b) =>
    [a.category, a.provider, a.scope, a.name].join(":").localeCompare([b.category, b.provider, b.scope, b.name].join(":"))
  );
}

export async function getItem(id: string, roots = defaultRoots()): Promise<RegistryDetail | undefined> {
  const item = (await listItems(roots)).find((candidate) => candidate.id === id);
  if (!item) return undefined;

  const detailPath = item.detailPath ?? item.path;
  const detail = await readText(detailPath);
  return {
    ...item,
    detail: detail || item.detailPreview || "No readable detail file was found for this item."
  };
}

export async function toggleItem(id: string, enabled: boolean, roots = defaultRoots()): Promise<RegistryDetail> {
  const item = (await listItems(roots)).find((candidate) => candidate.id === id);
  if (!item) {
    throw Object.assign(new Error("Item not found"), { statusCode: 404 });
  }
  if (!item.canToggle) {
    throw Object.assign(new Error("This item is inspectable but cannot be safely toggled as a standalone file entry."), {
      statusCode: 409
    });
  }

  const source = enabled ? item.backupPath : item.originalPath;
  const destination = enabled ? item.originalPath : item.backupPath;

  await ensureInsideAllowedRoots(source, destination, roots);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(source, destination);

  const refreshedId = makeId(item.provider, item.category, item.scope, item.name, item.originalPath, enabled ? "enabled" : "disabled");
  const refreshed = await getItem(refreshedId, roots);
  if (!refreshed) {
    throw Object.assign(new Error("Item moved, but refreshed registry entry was not found."), { statusCode: 500 });
  }
  return refreshed;
}

async function scanDirectoryItems(roots: RegistryRoots, category: Category, dirname: string, description: string): Promise<RegistryItem[]> {
  const items: RegistryItem[] = [];
  for (const provider of ["claude", "codex"] as const) {
    for (const scope of ["project", "home"] as const) {
      const root = path.join(scopeRoot(provider, scope, roots), dirname);
      for (const entry of await safeReadDir(root)) {
        if (!entry.isDirectory() && !entry.isFile()) continue;
        const originalPath = path.join(root, entry.name);
        items.push(
          makeFileItem({
            provider,
            category,
            scope,
            name: entry.name,
            originalPath,
            roots,
            description,
            detailPath: await firstDetailPath(originalPath)
          })
        );
      }
    }
  }
  return items;
}

async function scanSkills(roots: RegistryRoots): Promise<RegistryItem[]> {
  const items: RegistryItem[] = [];
  for (const provider of ["claude", "codex"] as const) {
    for (const scope of ["project", "home"] as const) {
      const base = scopeRoot(provider, scope, roots);
      const skillsRoot = path.join(base, "skills");
      for (const entry of await safeReadDir(skillsRoot)) {
        if (!entry.isDirectory()) continue;
        const originalPath = path.join(skillsRoot, entry.name);
        const skillPath = path.join(originalPath, "SKILL.md");
        if (!(await exists(skillPath))) continue;
        const text = await readText(skillPath);
        const description = extractDescription(text);
        items.push(makeFileItem({ provider, category: "skill", scope, name: entry.name, originalPath, roots, description, detailPath: skillPath }));
      }
    }
  }
  return items;
}

async function scanRules(roots: RegistryRoots): Promise<RegistryItem[]> {
  const candidates: Array<{ provider: Provider; scope: Scope; root: string; names: string[] }> = [
    { provider: "claude", scope: "project", root: path.join(roots.projectRoot, ".claude"), names: ["CLAUDE.md", "settings.json"] },
    { provider: "codex", scope: "project", root: path.join(roots.projectRoot, ".codex"), names: ["AGENTS.md", "config.toml"] },
    { provider: "claude", scope: "home", root: path.join(roots.homeDir, ".claude"), names: ["CLAUDE.md", "settings.json"] },
    { provider: "codex", scope: "home", root: path.join(roots.homeDir, ".codex"), names: ["AGENTS.md", "config.toml"] }
  ];

  const items: RegistryItem[] = [];
  for (const candidate of candidates) {
    for (const name of candidate.names) {
      const originalPath = path.join(candidate.root, name);
      if (await exists(originalPath)) {
        items.push(
          makeFileItem({
            provider: candidate.provider,
            category: "rule",
            scope: candidate.scope,
            name,
            originalPath,
            roots,
            description: `${candidate.provider} ${candidate.scope} rule/config file`,
            detailPath: originalPath
          })
        );
      }
    }

    const commandRoot = path.join(candidate.root, "commands");
    for (const file of await walkMarkdown(commandRoot)) {
      items.push(
        makeFileItem({
          provider: candidate.provider,
          category: "rule",
          scope: candidate.scope,
          name: path.relative(commandRoot, file),
          originalPath: file,
          roots,
          description: "Command or rule markdown",
          detailPath: file
        })
      );
    }
  }
  return items;
}

async function scanClaudeSettings(roots: RegistryRoots): Promise<RegistryItem[]> {
  const items: RegistryItem[] = [];
  for (const scope of ["project", "home"] as const) {
    const settingsPath = path.join(scopeRoot("claude", scope, roots), "settings.json");
    const settings = await readJson(settingsPath);
    if (!settings) continue;

    const mcpServers = objectRecord(settings.mcpServers ?? settings.mcp_servers);
    for (const [name, value] of Object.entries(mcpServers)) {
      items.push(makeConfigItem("claude", "mcp", scope, name, settingsPath, value, roots));
    }

    const hooks = objectRecord(settings.hooks);
    for (const [name, value] of Object.entries(hooks)) {
      items.push(makeConfigItem("claude", "hook", scope, name, settingsPath, value, roots));
    }
  }
  return items;
}

async function scanCodexConfig(roots: RegistryRoots): Promise<RegistryItem[]> {
  const items: RegistryItem[] = [];
  for (const scope of ["project", "home"] as const) {
    const configPath = path.join(scopeRoot("codex", scope, roots), "config.toml");
    const text = await readText(configPath);
    if (!text) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = parseToml(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }

    const mcpServers = objectRecord(parsed.mcp_servers ?? parsed.mcpServers);
    for (const [name, value] of Object.entries(mcpServers)) {
      items.push(makeConfigItem("codex", "mcp", scope, name, configPath, value, roots));
    }

    const hooks = objectRecord(parsed.hooks ?? parsed.hook);
    for (const [name, value] of Object.entries(hooks)) {
      items.push(makeConfigItem("codex", "hook", scope, name, configPath, value, roots));
    }
  }
  return items;
}

async function scanDisabled(roots: RegistryRoots): Promise<RegistryItem[]> {
  const items: RegistryItem[] = [];
  for (const provider of ["claude", "codex"] as const) {
    const backupRoot = backupRootFor(provider, roots);
    for (const scope of ["project", "home"] as const) {
      const backupSkillsRoot = path.join(backupRoot, scope, "skills");
      for (const entry of await safeReadDir(backupSkillsRoot)) {
        if (!entry.isDirectory()) continue;
        const backupPath = path.join(backupSkillsRoot, entry.name);
        const originalPath = path.join(scopeRoot(provider, scope, roots), "skills", entry.name);
        const detailPath = path.join(backupPath, "SKILL.md");
        items.push({
          id: makeId(provider, "skill", scope, entry.name, originalPath, "disabled"),
          provider,
          category: "skill",
          scope,
          name: entry.name,
          status: "disabled",
          path: backupPath,
          originalPath,
          backupPath,
          canToggle: true,
          description: extractDescription(await readText(detailPath)) ?? "Disabled skill backup",
          detailPath: (await exists(detailPath)) ? detailPath : undefined,
          detailPreview: await preview(detailPath)
        });
      }

      for (const category of ["agent", "plugin"] as const) {
        const dirname = category === "agent" ? "agents" : "plugins";
        const backupCategoryRoot = path.join(backupRoot, scope, dirname);
        for (const entry of await safeReadDir(backupCategoryRoot)) {
          if (!entry.isDirectory() && !entry.isFile()) continue;
          const backupPath = path.join(backupCategoryRoot, entry.name);
          const originalPath = path.join(scopeRoot(provider, scope, roots), dirname, entry.name);
          items.push({
            id: makeId(provider, category, scope, entry.name, originalPath, "disabled"),
            provider,
            category,
            scope,
            name: entry.name,
            status: "disabled",
            path: backupPath,
            originalPath,
            backupPath,
            canToggle: true,
            description: `Disabled ${category} backup`,
            detailPath: await firstDetailPath(backupPath),
            detailPreview: await preview(backupPath)
          });
        }
      }
    }

    for (const file of await walkAll(backupRoot)) {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
      const relative = path.relative(backupRoot, file);
      if (relative.includes(`${path.sep}skills${path.sep}`)) continue;
      if (relative.includes(`${path.sep}agents${path.sep}`)) continue;
      if (relative.includes(`${path.sep}plugins${path.sep}`)) continue;
      const segments = relative.split(path.sep);
      const scope = segments[0] === "project" ? "project" : "home";
      const originalPath = path.join(scopeRoot(provider, scope, roots), ...segments.slice(1));
      const category = inferCategoryFromPath(originalPath);
      const name = inferNameFromPath(originalPath, category);
      if (items.some((item) => item.originalPath === originalPath)) continue;
      items.push({
        id: makeId(provider, category, scope, name, originalPath, "disabled"),
        provider,
        category,
        scope,
        name,
        status: "disabled",
        path: file,
        originalPath,
        backupPath: path.join(backupRoot, relative),
        canToggle: true,
        description: "Disabled backup item",
        detailPath: file,
        detailPreview: await preview(file)
      });
    }
  }
  return items;
}

function makeFileItem(input: {
  provider: Provider;
  category: Category;
  scope: Scope;
  name: string;
  originalPath: string;
  roots: RegistryRoots;
  description?: string;
  detailPath?: string;
}): RegistryItem {
  const backupPath = backupPathFor(input.provider, input.scope, input.originalPath, input.roots);
  return {
    id: makeId(input.provider, input.category, input.scope, input.name, input.originalPath, "enabled"),
    provider: input.provider,
    category: input.category,
    scope: input.scope,
    name: input.name,
    status: "enabled",
    path: input.originalPath,
    originalPath: input.originalPath,
    backupPath,
    canToggle: true,
    description: input.description,
    detailPath: input.detailPath,
    detailPreview: input.detailPath ? undefined : ""
  };
}

function makeConfigItem(
  provider: Provider,
  category: Category,
  scope: Scope,
  name: string,
  configPath: string,
  value: unknown,
  roots: RegistryRoots
): RegistryItem {
  const detailPreview = JSON.stringify(value, null, 2);
  return {
    id: makeId(provider, category, scope, name, `${configPath}#${category}:${name}`, "enabled"),
    provider,
    category,
    scope,
    name,
    status: "enabled",
    path: configPath,
    originalPath: configPath,
    backupPath: backupPathFor(provider, scope, configPath, roots),
    canToggle: false,
    description: `${provider} ${category} config entry`,
    detailPath: configPath,
    detailPreview
  };
}

function backupPathFor(provider: Provider, scope: Scope, originalPath: string, roots: RegistryRoots): string {
  const relative = path.relative(scopeRoot(provider, scope, roots), originalPath);
  return path.join(backupRootFor(provider, roots), scope, relative);
}

function backupRootFor(provider: Provider, roots: RegistryRoots): string {
  return path.join(roots.homeDir, provider === "claude" ? ".claude_bak" : ".codex_bak");
}

function scopeRoot(provider: Provider, scope: Scope, roots: RegistryRoots): string {
  if (scope === "project") return path.join(roots.projectRoot, provider === "claude" ? ".claude" : ".codex");
  return path.join(roots.homeDir, provider === "claude" ? ".claude" : ".codex");
}

function makeId(provider: Provider, category: Category, scope: Scope, name: string, stablePath: string, status: string): string {
  return crypto.createHash("sha1").update([provider, category, scope, name, stablePath, status].join("\0")).digest("hex");
}

async function ensureInsideAllowedRoots(source: string, destination: string, roots: RegistryRoots): Promise<void> {
  const allowed = [
    roots.projectRoot,
    path.join(roots.homeDir, ".claude"),
    path.join(roots.homeDir, ".codex"),
    path.join(roots.homeDir, ".claude_bak"),
    path.join(roots.homeDir, ".codex_bak")
  ].map((entry) => path.resolve(entry));
  for (const target of [source, destination].map((entry) => path.resolve(entry))) {
    if (!allowed.some((root) => target === root || target.startsWith(`${root}${path.sep}`))) {
      throw Object.assign(new Error(`Refusing to move path outside allowed roots: ${target}`), { statusCode: 403 });
    }
  }
}

function inferCategoryFromPath(filePath: string): Category {
  if (filePath.includes(`${path.sep}skills${path.sep}`)) return "skill";
  if (filePath.includes(`${path.sep}agents${path.sep}`)) return "agent";
  if (filePath.includes(`${path.sep}plugins${path.sep}`)) return "plugin";
  if (filePath.endsWith("settings.json") || filePath.endsWith("config.toml")) return "rule";
  return "rule";
}

function inferNameFromPath(filePath: string, category: Category): string {
  if (category === "skill" || category === "agent" || category === "plugin") {
    const parts = filePath.split(path.sep);
    const index = parts.lastIndexOf(category === "skill" ? "skills" : `${category}s`);
    return index >= 0 ? parts[index + 1] : path.basename(path.dirname(filePath));
  }
  return path.basename(filePath);
}

async function firstDetailPath(target: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(target);
    if (stat.isFile()) return target;
  } catch {
    return undefined;
  }

  for (const name of ["README.md", "readme.md", "SKILL.md", "AGENT.md", "PLUGIN.md", "package.json"]) {
    const candidate = path.join(target, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function extractDescription(text: string): string | undefined {
  const yamlDescription = text.match(/^description:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
  if (yamlDescription) return yamlDescription.trim();
  const paragraph = text
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s*/gm, "").trim())
    .find((part) => part.length > 20);
  return paragraph?.slice(0, 240);
}

async function preview(filePath: string): Promise<string> {
  return (await readText(filePath)).slice(0, 500);
}

async function readText(filePath: string): Promise<string> {
  try {
    return (await fs.readFile(filePath, "utf8")).slice(0, TEXT_LIMIT);
  } catch {
    return "";
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | undefined> {
  const text = await readText(filePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walkMarkdown(root: string): Promise<string[]> {
  return (await walkAll(root)).filter((file) => file.endsWith(".md"));
}

async function walkAll(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await safeReadDir(root)) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkAll(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
