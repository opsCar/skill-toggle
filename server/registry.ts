import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parse as parseToml } from "smol-toml";
import type { Category, Provider, RegistryDetail, RegistryItem, RegistryRoots, Scope } from "./registry-types";

const TEXT_LIMIT = 24_000;

function defaultRoots(): RegistryRoots {
  return {
    projectRoot: process.env.SKILL_TOGGLE_PROJECT_ROOT ?? process.cwd(),
    homeDir: process.env.SKILL_TOGGLE_HOME ?? os.homedir()
  };
}

export async function listItems(roots = defaultRoots()): Promise<RegistryItem[]> {
  const groups = await Promise.all([
    scanSkills(roots),
    scanDirectoryItems(roots, "agent", "agents", "Agent definition"),
    scanDirectoryItems(roots, "plugin", "plugins", "Plugin bundle"),
    scanRules(roots),
    scanClaudeSettings(roots),
    scanCodexConfig(roots),
    scanDisabled(roots)
  ]);

  const deduped = new Map<string, RegistryItem>();
  for (const item of groups.flat()) {
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

const PROVIDER_SCOPES: Array<{ provider: Provider; scope: Scope }> = (["claude", "codex"] as const).flatMap((provider) =>
  (["project", "home"] as const).map((scope) => ({ provider, scope }))
);

async function scanDirectoryItems(roots: RegistryRoots, category: Category, dirname: string, description: string): Promise<RegistryItem[]> {
  const groups = await Promise.all(
    PROVIDER_SCOPES.map(async ({ provider, scope }) => {
      const root = path.join(scopeRoot(provider, scope, roots), dirname);
      const entries = await safeReadDir(root);
      const usable = entries.filter((entry) => entry.isDirectory() || entry.isFile());
      return Promise.all(
        usable.map(async (entry) => {
          const originalPath = path.join(root, entry.name);
          return makeFileItem({
            provider,
            category,
            scope,
            name: entry.name,
            originalPath,
            roots,
            description,
            detailPath: await firstDetailPath(originalPath)
          });
        })
      );
    })
  );
  return groups.flat();
}

async function scanSkills(roots: RegistryRoots): Promise<RegistryItem[]> {
  const groups = await Promise.all(
    PROVIDER_SCOPES.map(async ({ provider, scope }) => {
      const skillsRoot = path.join(scopeRoot(provider, scope, roots), "skills");
      const entries = (await safeReadDir(skillsRoot)).filter((entry) => entry.isDirectory());
      const built = await Promise.all(
        entries.map(async (entry) => {
          const originalPath = path.join(skillsRoot, entry.name);
          const skillPath = path.join(originalPath, "SKILL.md");
          if (!(await exists(skillPath))) return undefined;
          const description = extractDescription(await readText(skillPath));
          return makeFileItem({ provider, category: "skill", scope, name: entry.name, originalPath, roots, description, detailPath: skillPath });
        })
      );
      return built.filter((item): item is RegistryItem => item !== undefined);
    })
  );
  return groups.flat();
}

async function scanRules(roots: RegistryRoots): Promise<RegistryItem[]> {
  const candidates: Array<{ provider: Provider; scope: Scope; root: string; names: string[] }> = [
    { provider: "claude", scope: "project", root: path.join(roots.projectRoot, ".claude"), names: ["CLAUDE.md", "settings.json"] },
    { provider: "codex", scope: "project", root: path.join(roots.projectRoot, ".codex"), names: ["AGENTS.md", "config.toml"] },
    { provider: "claude", scope: "home", root: path.join(roots.homeDir, ".claude"), names: ["CLAUDE.md", "settings.json"] },
    { provider: "codex", scope: "home", root: path.join(roots.homeDir, ".codex"), names: ["AGENTS.md", "config.toml"] }
  ];

  const groups = await Promise.all(
    candidates.map(async (candidate) => {
      const namedItems = await Promise.all(
        candidate.names.map(async (name) => {
          const originalPath = path.join(candidate.root, name);
          if (!(await exists(originalPath))) return undefined;
          return makeFileItem({
            provider: candidate.provider,
            category: "rule",
            scope: candidate.scope,
            name,
            originalPath,
            roots,
            description: `${candidate.provider} ${candidate.scope} rule/config file`,
            detailPath: originalPath
          });
        })
      );

      const rootRuleItems = candidate.provider === "claude" && candidate.scope === "project"
        ? await Promise.all(
            [path.join(roots.projectRoot, ".mcp.json")].map(async (originalPath) => {
              if (!(await exists(originalPath))) return undefined;
              return makeFileItem({
                provider: "claude",
                category: "rule",
                scope: "project",
                name: ".mcp.json",
                originalPath,
                roots,
                description: "Claude project MCP config file",
                detailPath: originalPath
              });
            })
          )
        : [];

      const commandRoot = path.join(candidate.root, "commands");
      const commandFiles = await walkMarkdown(commandRoot);
      const commandItems = commandFiles.map((file) =>
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

      return [...namedItems.filter((item): item is RegistryItem => item !== undefined), ...rootRuleItems.filter((item): item is RegistryItem => item !== undefined), ...commandItems];
    })
  );
  return groups.flat();
}

async function scanClaudeSettings(roots: RegistryRoots): Promise<RegistryItem[]> {
  const configFiles: Array<{ scope: Scope; path: string }> = [
    { scope: "home", path: path.join(roots.homeDir, ".claude.json") },
    { scope: "home", path: path.join(roots.homeDir, ".claude", "settings.json") },
    { scope: "home", path: path.join(roots.homeDir, ".config", "claude", "settings.json") },
    { scope: "project", path: path.join(roots.projectRoot, ".mcp.json") },
    { scope: "project", path: path.join(roots.projectRoot, ".claude", "settings.json") }
  ];

  const groups = await Promise.all(
    configFiles.map(async (config) => {
      const settings = await readJson(config.path);
      if (!settings) return [];
      const mcpItems = Object.entries(objectRecord(settings.mcpServers ?? settings.mcp_servers)).map(([name, value]) =>
        makeConfigItem("claude", "mcp", config.scope, name, config.path, value, roots)
      );
      const currentProject = objectRecord(objectRecord(settings.projects)[roots.projectRoot]);
      const projectMcpItems = Object.entries(objectRecord(currentProject.mcpServers)).map(([name, value]) =>
        makeConfigItem("claude", "mcp", "project", name, config.path, value, roots, `projects.${roots.projectRoot}.mcpServers.${name}`)
      );
      const hookItems = Object.entries(objectRecord(settings.hooks)).map(([name, value]) =>
        makeConfigItem("claude", "hook", config.scope, name, config.path, value, roots)
      );
      return [...mcpItems, ...projectMcpItems, ...hookItems];
    })
  );
  return groups.flat();
}

async function scanCodexConfig(roots: RegistryRoots): Promise<RegistryItem[]> {
  const groups = await Promise.all(
    (["project", "home"] as const).map(async (scope) => {
      const configPath = path.join(scopeRoot("codex", scope, roots), "config.toml");
      const text = await readText(configPath);
      if (!text) return [];
      let parsed: Record<string, unknown> = {};
      try {
        parsed = parseToml(text) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const mcpItems = Object.entries(objectRecord(parsed.mcp_servers ?? parsed.mcpServers)).map(([name, value]) =>
        makeConfigItem("codex", "mcp", scope, name, configPath, value, roots)
      );
      const hookItems = Object.entries(objectRecord(parsed.hooks ?? parsed.hook)).map(([name, value]) =>
        makeConfigItem("codex", "hook", scope, name, configPath, value, roots)
      );
      return [...mcpItems, ...hookItems];
    })
  );
  return groups.flat();
}

async function scanDisabled(roots: RegistryRoots): Promise<RegistryItem[]> {
  const providerGroups = await Promise.all(
    (["claude", "codex"] as const).map(async (provider) => {
      const backupRoot = backupRootFor(provider, roots);

      const scopeGroups = await Promise.all(
        (["project", "home"] as const).map(async (scope) => {
          const backupSkillsRoot = path.join(backupRoot, scope, "skills");
          const skillEntries = (await safeReadDir(backupSkillsRoot)).filter((entry) => entry.isDirectory());
          const skillItems = await Promise.all(
            skillEntries.map(async (entry) => {
              const backupPath = path.join(backupSkillsRoot, entry.name);
              const originalPath = path.join(scopeRoot(provider, scope, roots), "skills", entry.name);
              const detailPath = path.join(backupPath, "SKILL.md");
              const [text, hasDetail, previewText] = await Promise.all([
                readText(detailPath),
                exists(detailPath),
                preview(detailPath)
              ]);
              return {
                id: makeId(provider, "skill", scope, entry.name, originalPath, "disabled"),
                provider,
                category: "skill" as Category,
                scope,
                name: entry.name,
                status: "disabled" as const,
                path: backupPath,
                originalPath,
                backupPath,
                canToggle: true,
                description: extractDescription(text) ?? "Disabled skill backup",
                detailPath: hasDetail ? detailPath : undefined,
                detailPreview: previewText
              };
            })
          );

          const categoryGroups = await Promise.all(
            (["agent", "plugin"] as const).map(async (category) => {
              const dirname = category === "agent" ? "agents" : "plugins";
              const backupCategoryRoot = path.join(backupRoot, scope, dirname);
              const entries = (await safeReadDir(backupCategoryRoot)).filter((entry) => entry.isDirectory() || entry.isFile());
              return Promise.all(
                entries.map(async (entry) => {
                  const backupPath = path.join(backupCategoryRoot, entry.name);
                  const originalPath = path.join(scopeRoot(provider, scope, roots), dirname, entry.name);
                  const [detailPath, previewText] = await Promise.all([firstDetailPath(backupPath), preview(backupPath)]);
                  return {
                    id: makeId(provider, category, scope, entry.name, originalPath, "disabled"),
                    provider,
                    category,
                    scope,
                    name: entry.name,
                    status: "disabled" as const,
                    path: backupPath,
                    originalPath,
                    backupPath,
                    canToggle: true,
                    description: `Disabled ${category} backup`,
                    detailPath,
                    detailPreview: previewText
                  };
                })
              );
            })
          );

          return [...skillItems, ...categoryGroups.flat()];
        })
      );

      const knownItems = scopeGroups.flat();
      const knownPaths = new Set(knownItems.map((item) => item.originalPath));

      const files = await walkAll(backupRoot);
      const fileItems = await Promise.all(
        files.map(async (file) => {
          const stat = await fs.stat(file);
          if (!stat.isFile()) return undefined;
          const relative = path.relative(backupRoot, file);
          if (relative.includes(`${path.sep}skills${path.sep}`)) return undefined;
          if (relative.includes(`${path.sep}agents${path.sep}`)) return undefined;
          if (relative.includes(`${path.sep}plugins${path.sep}`)) return undefined;
          const segments = relative.split(path.sep);
          const scope: Scope = segments[0] === "project" ? "project" : "home";
          const originalPath = path.join(scopeRoot(provider, scope, roots), ...segments.slice(1));
          if (knownPaths.has(originalPath)) return undefined;
          const category = inferCategoryFromPath(originalPath);
          const name = inferNameFromPath(originalPath, category);
          return {
            id: makeId(provider, category, scope, name, originalPath, "disabled"),
            provider,
            category,
            scope,
            name,
            status: "disabled" as const,
            path: file,
            originalPath,
            backupPath: path.join(backupRoot, relative),
            canToggle: true,
            description: "Disabled backup item",
            detailPath: file,
            detailPreview: await preview(file)
          };
        })
      );

      const seenInWalk = new Set<string>();
      const extras: RegistryItem[] = [];
      for (const item of fileItems) {
        if (!item) continue;
        if (seenInWalk.has(item.originalPath)) continue;
        seenInWalk.add(item.originalPath);
        extras.push(item);
      }

      return [...knownItems, ...extras];
    })
  );
  return providerGroups.flat();
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
  roots: RegistryRoots,
  stableKey = name
): RegistryItem {
  const detailPreview = JSON.stringify(value, null, 2);
  return {
    id: makeId(provider, category, scope, name, `${configPath}#${category}:${stableKey}`, "enabled"),
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
