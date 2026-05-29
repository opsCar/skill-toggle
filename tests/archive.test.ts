import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let tmp = "";
let oldHome = "";
let oldProjectRoot: string | undefined;

async function writeFile(target: string, content: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-archive-"));
  oldHome = process.env.HOME ?? "";
  oldProjectRoot = process.env.SKILL_TOGGLE_PROJECT_ROOT;
  process.env.HOME = tmp;
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

test("exports the full env, then inspects and appends a selected skill into a clean target", async () => {
  // Source env with one skill and one MCP config entry.
  await writeFile(path.join(tmp, ".claude", "skills", "planner", "SKILL.md"), "---\nname: planner\ndescription: Planning helper\n---\nPlan.\n");
  await writeFile(path.join(tmp, ".codex", "config.toml"), "[mcp_servers.demo]\ncommand = \"demo\"\n");

  const { writeExportArchive, inspectImportArchive, appendImportArchive } = await import("../server/archive");

  const archivePath = path.join(tmp, "export.tar.gz");
  const summary = await writeExportArchive(archivePath);
  expect(summary.sources).toEqual(expect.arrayContaining([".claude", ".codex"]));
  expect((await fs.stat(archivePath)).size).toBeGreaterThan(0);

  const inspection = await inspectImportArchive(archivePath);
  const skill = inspection.items.find((item) => item.category === "skills" && item.name === "planner");
  const mcp = inspection.items.find((item) => item.category === "mcp" && item.name === "demo");
  expect(skill).toBeTruthy();
  expect(mcp).toBeTruthy();

  // Remove the skill from the live env, then append it back from the archive.
  await fs.rm(path.join(tmp, ".claude", "skills", "planner"), { recursive: true, force: true });
  const appendResult = await appendImportArchive(archivePath, [skill!.id]);
  expect(appendResult.appendedItems).toContain("planner");
  await expect(fs.access(path.join(tmp, ".claude", "skills", "planner", "SKILL.md"))).resolves.toBeUndefined();
});

test("append refuses to overwrite an existing path item", async () => {
  await writeFile(path.join(tmp, ".claude", "skills", "planner", "SKILL.md"), "---\nname: planner\ndescription: Planning helper\n---\nPlan.\n");
  const { writeExportArchive, inspectImportArchive, appendImportArchive } = await import("../server/archive");

  const archivePath = path.join(tmp, "export.tar.gz");
  await writeExportArchive(archivePath);
  const inspection = await inspectImportArchive(archivePath);
  const skill = inspection.items.find((item) => item.category === "skills" && item.name === "planner")!;

  // The skill still exists in the live env, so append must refuse.
  await expect(appendImportArchive(archivePath, [skill.id])).rejects.toThrow(/overwrite/i);
});

test("replace import snapshots the current env before swapping it in", async () => {
  await writeFile(path.join(tmp, ".claude", "skills", "old", "SKILL.md"), "---\nname: old\ndescription: Old skill\n---\nOld.\n");

  // Build an archive that contains a different skill by exporting from a
  // separate staging HOME.
  const stagingHome = path.join(tmp, "other-home");
  await writeFile(path.join(stagingHome, ".claude", "skills", "fresh", "SKILL.md"), "---\nname: fresh\ndescription: Fresh skill\n---\nFresh.\n");
  const archivePath = path.join(tmp, "incoming.tar.gz");
  process.env.HOME = stagingHome;
  vi.resetModules();
  const { writeExportArchive } = await import("../server/archive");
  await writeExportArchive(archivePath);

  // Switch back to the live env and replace it from the archive.
  process.env.HOME = tmp;
  vi.resetModules();
  const { applyImportArchive } = await import("../server/archive");
  const result = await applyImportArchive(archivePath);

  expect(result.restoredSources).toContain(".claude");
  expect(result.preImportBackup).toContain("pre-import-");
  await expect(fs.access(result.preImportBackup)).resolves.toBeUndefined();
  // The replaced env now contains the archive's skill, not the original.
  await expect(fs.access(path.join(tmp, ".claude", "skills", "fresh", "SKILL.md"))).resolves.toBeUndefined();
  await expect(fs.access(path.join(tmp, ".claude", "skills", "old"))).rejects.toThrow();
});
