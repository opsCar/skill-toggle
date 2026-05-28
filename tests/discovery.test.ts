import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let tmp = "";
let oldHome = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-"));
  oldHome = process.env.HOME ?? "";
  process.env.HOME = tmp;
  vi.resetModules();
});

afterEach(async () => {
  process.env.HOME = oldHome;
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

test("lists Claude MCP entries from global state and project .mcp.json", async () => {
  const oldCwd = process.cwd();
  const projectDir = path.join(tmp, "project");
  await fs.mkdir(projectDir, { recursive: true });
  process.chdir(projectDir);
  const activeProjectRoot = process.cwd();

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

  try {
    const { listInventory } = await import("../server/discovery");
    const items = await listInventory();

    expect(items.some((row) => row.tool === "claude" && row.category === "mcp" && row.name === "chrome-devtools" && row.path === globalStatePath)).toBe(true);
    expect(items.some((row) => row.tool === "claude" && row.category === "mcp" && row.name === "localdb" && row.path === globalStatePath)).toBe(true);
    expect(items.some((row) => row.tool === "claude" && row.category === "mcp" && row.name === "context7" && row.path === projectMcpPath)).toBe(true);
  } finally {
    process.chdir(oldCwd);
  }
});
