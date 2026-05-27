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

  const detail = await getDetail(item!.id);
  expect(detail?.detail).toContain("Sample Skill");
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

  await toggleItem(item!.id, false);
  expect(await fs.readFile(configPath, "utf8")).not.toContain("demo");
  const disabled = (await listInventory()).find((row) => row.id === item!.id);
  expect(disabled?.enabled).toBe(false);

  await toggleItem(item!.id, true);
  expect(await fs.readFile(configPath, "utf8")).toContain("demo");
});
