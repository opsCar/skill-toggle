import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let tmp = "";
let oldHome = "";
let oldProjectRoot: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-"));
  oldHome = process.env.HOME ?? "";
  oldProjectRoot = process.env.SKILL_TOGGLE_PROJECT_ROOT;
  process.env.HOME = tmp;
  // Pin the project root to an isolated dir so the repo's own CLAUDE.md /
  // AGENTS.md / skills never leak into the inventory under test.
  process.env.SKILL_TOGGLE_PROJECT_ROOT = path.join(tmp, "workspace");
  await fs.mkdir(process.env.SKILL_TOGGLE_PROJECT_ROOT, { recursive: true });
  vi.resetModules();
});

afterEach(async () => {
  process.env.HOME = oldHome;
  if (oldProjectRoot === undefined) delete process.env.SKILL_TOGGLE_PROJECT_ROOT;
  else process.env.SKILL_TOGGLE_PROJECT_ROOT = oldProjectRoot;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("lists skills and exposes markdown detail", async () => {
  const skillDir = path.join(tmp, ".claude", ".cursor", "skills", "sample-skill");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\ndescription: Sample\n---\n# Sample Skill\n");

  const { listInventory, getDetail } = await import("../server/discovery");
  const items = await listInventory();
  const item = items.find((row) => row.name === "sample-skill");

  expect(item?.category).toBe("skills");
  expect(item?.enabled).toBe(true);
  expect(item?.builtin).toBe(false);
  expect(item?.context.estimatedTokens).toBeGreaterThan(0);
  expect(item?.context.lines).toBeGreaterThanOrEqual(4);

  const detail = await getDetail(item!.id);
  expect(detail?.detail).toContain("Sample Skill");
  expect(detail?.context.characters).toBe(item?.context.characters);
});

test("lists agents and plugins as toggleable path items", async () => {
  const agentDir = path.join(tmp, ".codex", "agents", "reviewer");
  const pluginDir = path.join(tmp, ".codex", "plugins", "browser");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "README.md"), "# Reviewer Agent\n");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, "README.md"), "# Browser Plugin\n");

  const { listInventory, getDetail, toggleItem } = await import("../server/discovery");
  const items = await listInventory();
  const agent = items.find((row) => row.tool === "codex" && row.category === "agents" && row.name === "reviewer");
  const plugin = items.find((row) => row.tool === "codex" && row.category === "plugins" && row.name === "browser");

  expect(agent?.enabled).toBe(true);
  expect(plugin?.enabled).toBe(true);
  expect((await getDetail(agent!.id))?.detail).toContain("Reviewer Agent");
  expect((await getDetail(plugin!.id))?.detail).toContain("Browser Plugin");

  await toggleItem(agent!.id, false);
  await expect(fs.access(agentDir)).rejects.toThrow();
  const disabled = (await listInventory()).find((row) => row.id === agent!.id);
  expect(disabled?.enabled).toBe(false);
  expect(disabled?.category).toBe("agents");
});

test("disables and restores a path item through the tool backup root", async () => {
  const rulePath = path.join(tmp, ".codex", "rules", "typescript.md");
  await fs.mkdir(path.dirname(rulePath), { recursive: true });
  await fs.writeFile(rulePath, "# TypeScript Rules\n");

  const { listInventory, toggleItem } = await import("../server/discovery");
  const active = (await listInventory()).find((row) => row.tool === "codex" && row.category === "rules" && row.name === "typescript");
  expect(active?.enabled).toBe(true);

  await toggleItem(active!.id, false);
  await expect(fs.access(rulePath)).rejects.toThrow();
  const disabled = (await listInventory()).find((row) => row.id === active!.id);
  expect(disabled?.enabled).toBe(false);
  expect(disabled?.backupPath).toContain(".codex_bak");

  await toggleItem(active!.id, true);
  await expect(fs.access(rulePath)).resolves.toBeUndefined();
});

test("keeps a re-created path item live and flags its stale backup instead of masking it", async () => {
  // Disable a skill through skill-toggle (moves it into the tool backup)...
  const skillDir = path.join(tmp, ".claude", "skills", "plan-eng-review");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: plan-eng-review\ndescription: Review eng plans.\n---\nBody.\n");

  const { listInventory, toggleItem } = await import("../server/discovery");
  const active = (await listInventory()).find((row) => row.category === "skills" && row.name === "plan-eng-review");
  await toggleItem(active!.id, false);
  await expect(fs.access(skillDir)).rejects.toThrow();

  // ...then a different tool re-creates the skill on disk at the same path.
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: plan-eng-review\ndescription: Review eng plans.\n---\nBody.\n");

  // The inventory must report it as live (the CLI will load it), not disabled.
  const reconciled = (await listInventory()).find((row) => row.category === "skills" && row.name === "plan-eng-review");
  expect(reconciled?.enabled).toBe(true);
  expect(reconciled?.valid).toBe(false);
  expect(reconciled?.invalidReason).toContain("Re-enabled outside skill-toggle");
  expect(reconciled?.backupPath).toContain(".claude_bak");
  // Exactly one row for this item — the stale backup must not appear as a second entry.
  expect((await listInventory()).filter((row) => row.category === "skills" && row.name === "plan-eng-review")).toHaveLength(1);
});

test("reconcile drops stale backups for re-installed items but keeps genuinely disabled ones", async () => {
  const reinstalledDir = path.join(tmp, ".claude", "skills", "plan-eng-review");
  const stillDisabledDir = path.join(tmp, ".claude", "skills", "office-hours");
  for (const dir of [reinstalledDir, stillDisabledDir]) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${path.basename(dir)}\ndescription: A skill.\n---\nBody.\n`);
  }

  const { listInventory, toggleItem, reconcileStaleBackups } = await import("../server/discovery");
  const items = await listInventory();
  const reinstalled = items.find((row) => row.category === "skills" && row.name === "plan-eng-review")!;
  const stillDisabled = items.find((row) => row.category === "skills" && row.name === "office-hours")!;

  // Disable both through skill-toggle (moves each into ~/.claude_bak/items/<id>).
  await toggleItem(reinstalled.id, false);
  await toggleItem(stillDisabled.id, false);

  // The user reinstalls only the first skill on disk at its original path.
  await fs.mkdir(reinstalledDir, { recursive: true });
  await fs.writeFile(path.join(reinstalledDir, "SKILL.md"), "---\nname: plan-eng-review\ndescription: A skill.\n---\nBody.\n");

  // Pre-check: the reinstalled skill is flagged invalid by the stale backup.
  const flagged = (await listInventory()).find((row) => row.id === reinstalled.id);
  expect(flagged?.valid).toBe(false);

  const result = await reconcileStaleBackups();
  expect(result.reconciled).toHaveLength(1);
  expect(result.reconciled[0]).toMatchObject({ name: "plan-eng-review", kind: "path" });

  // The reinstalled skill is now clean; the untouched one stays disabled.
  const after = await listInventory();
  const healed = after.find((row) => row.id === reinstalled.id);
  expect(healed?.enabled).toBe(true);
  expect(healed?.valid).toBe(true);
  const preserved = after.find((row) => row.id === stillDisabled.id);
  expect(preserved?.enabled).toBe(false);
});

test("reconcile drops a stale config-entry backup when the entry is re-added", async () => {
  const configPath = path.join(tmp, ".codex", "config.toml");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, "[mcp_servers.demo]\ncommand = \"demo\"\n");

  const { listInventory, toggleItem, reconcileStaleBackups } = await import("../server/discovery");
  const item = (await listInventory()).find((row) => row.tool === "codex" && row.category === "mcp" && row.name === "demo")!;

  // Disable (writes a config backup + strips the entry), then the user re-adds it manually.
  await toggleItem(item.id, false);
  await fs.writeFile(configPath, "[mcp_servers.demo]\ncommand = \"demo\"\n");

  const result = await reconcileStaleBackups();
  expect(result.reconciled).toHaveLength(1);
  expect(result.reconciled[0]).toMatchObject({ name: "demo", kind: "config-entry" });

  const after = (await listInventory()).find((row) => row.id === item.id);
  expect(after?.enabled).toBe(true);
});

test("lists and toggles MCP config entries", async () => {
  const configPath = path.join(tmp, ".codex", "config.toml");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, "[mcp_servers.demo]\ncommand = \"demo\"\n");

  const { listInventory, toggleItem } = await import("../server/discovery");
  const item = (await listInventory()).find((row) => row.tool === "codex" && row.category === "mcp" && row.name === "demo");
  expect(item?.enabled).toBe(true);
  expect(item?.context.characters).toBeGreaterThan(0);
  expect(item?.context.estimatedTokens).toBe(Math.ceil(item!.context.characters / item!.context.charsPerToken));

  await toggleItem(item!.id, false);
  expect(await fs.readFile(configPath, "utf8")).not.toContain("demo");
  const disabled = (await listInventory()).find((row) => row.id === item!.id);
  expect(disabled?.enabled).toBe(false);

  await toggleItem(item!.id, true);
  expect(await fs.readFile(configPath, "utf8")).toContain("demo");
});

test("exposes frontmatter description as routingDescription for skills and agents", async () => {
  const skillFile = path.join(tmp, ".claude", "skills", "planner", "SKILL.md");
  const agentFile = path.join(tmp, ".claude", "agents", "reviewer.md");
  await fs.mkdir(path.dirname(skillFile), { recursive: true });
  await fs.mkdir(path.dirname(agentFile), { recursive: true });
  await fs.writeFile(skillFile, "---\nname: planner\ndescription: Plan multi-step work before coding.\n---\nBody.\n");
  await fs.writeFile(agentFile, "---\nname: reviewer\ndescription: Reviews diffs for correctness.\n---\nReview.\n");

  const { listInventory } = await import("../server/discovery");
  const items = await listInventory();
  const skill = items.find((row) => row.tool === "claude" && row.category === "skills" && row.name === "planner");
  const agent = items.find((row) => row.tool === "claude" && row.category === "agents" && row.name === "reviewer");

  expect(skill?.routingDescription).toBe("Plan multi-step work before coding.");
  expect(agent?.routingDescription).toBe("Reviews diffs for correctness.");
});

test("lists unreadable skill entries as invalid instead of throwing", async () => {
  const skillsDir = path.join(tmp, ".codex", "skills");
  const brokenSkill = path.join(skillsDir, "ZSDD");
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.symlink(path.join(tmp, "missing-skill-target"), brokenSkill);

  const { listInventory, getDetail } = await import("../server/discovery");
  const items = await listInventory();
  const skill = items.find((row) => row.tool === "codex" && row.category === "skills" && row.name === "ZSDD");

  expect(skill?.valid).toBe(false);
  expect(skill?.invalidReason).toContain("ENOENT");
  expect(skill?.context.characters).toBe(0);
  expect((await getDetail(skill!.id))?.detail).toContain("ZSDD");
});

test("lists Claude MCP entries from global state and project .mcp.json", async () => {
  const projectDir = path.join(tmp, "project");
  await fs.mkdir(projectDir, { recursive: true });
  process.env.SKILL_TOGGLE_PROJECT_ROOT = projectDir;
  const activeProjectRoot = projectDir;

  const globalStatePath = path.join(tmp, ".claude.json");
  await fs.writeFile(
    globalStatePath,
    JSON.stringify(
      {
        mcpServers: {
          "chrome-devtools": {
            type: "stdio",
            command: "npx",
            args: ["chrome-devtools-mcp@latest"]
          }
        },
        projects: {
          [activeProjectRoot]: {
            mcpServers: {
              localdb: { command: "localdb-mcp" }
            }
          }
        }
      },
      null,
      2
    )
  );

  const projectMcpPath = path.join(activeProjectRoot, ".mcp.json");
  await fs.writeFile(projectMcpPath, JSON.stringify({ mcpServers: { context7: { url: "https://mcp.context7.com/mcp" } } }, null, 2));

  const { listInventory } = await import("../server/discovery");
  const items = await listInventory();

  expect(items.some((row) => row.tool === "claude" && row.category === "mcp" && row.name === "chrome-devtools" && row.path === globalStatePath)).toBe(true);
  expect(items.some((row) => row.tool === "claude" && row.category === "mcp" && row.name === "localdb" && row.path === globalStatePath)).toBe(true);
  expect(items.some((row) => row.tool === "claude" && row.category === "mcp" && row.name === "context7" && row.path === projectMcpPath)).toBe(true);
});
