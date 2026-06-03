import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let tmp = "";
let oldHome = "";
let oldProjectRoot: string | undefined;

const DAY = 24 * 60 * 60 * 1000;

async function writeSkill(toolDir: string, name: string, description: string, bodyChars = 8000) {
  const skillFile = path.join(tmp, toolDir, "skills", name, "SKILL.md");
  await fs.mkdir(path.dirname(skillFile), { recursive: true });
  await fs.writeFile(skillFile, `---\nname: ${name}\ndescription: ${description}\n---\n${"x".repeat(bodyChars)}\n`);
  return skillFile;
}

async function setMtime(file: string, ageDays: number) {
  const when = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(file, when, when);
}

async function writeClaudeUserMessage(text: string, timestamp: string) {
  const file = path.join(tmp, ".claude", "projects", "p", "session.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const row = { type: "user", timestamp, cwd: process.cwd(), message: { role: "user", content: text } };
  await fs.writeFile(file, JSON.stringify(row) + "\n");
}

function lowUsage(
  run: { findings: Array<{ ruleId: string; items: Array<{ name: string }>; severity: string; metrics: Record<string, number | string> }> },
  name: string
) {
  return run.findings.find((f) => f.ruleId === "low-usage" && f.items[0]?.name === name);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-diag-"));
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

test("flags a heavy, never-used, settled item as high severity low-usage", async () => {
  const skillFile = await writeSkill(".claude", "bloated", "A large helper nobody calls.");
  await setMtime(skillFile, 30);

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");

  const finding = run.findings.find((f) => f.ruleId === "low-usage");
  expect(finding?.severity).toBe("high");
  expect(finding?.items[0]?.name).toBe("bloated");
  expect(finding?.metrics.uses).toBe(0);
  expect(finding?.detail).toContain("0 matched uses");
  expect(finding?.actions.map((a) => a.type).sort()).toEqual(["disable", "inspect"]);
});

test("skips items below the token floor", async () => {
  const small = await writeSkill(".claude", "tiny", "Small helper.", 100);
  await setMtime(small, 30);

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  expect(lowUsage(run, "tiny")).toBeUndefined();
});

test("skips freshly installed items within the recency guard", async () => {
  const fresh = await writeSkill(".claude", "fresh", "Heavy but brand new.");
  await setMtime(fresh, 1);

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  expect(lowUsage(run, "fresh")).toBeUndefined();
});

test("flags a heavy, barely-used item as medium severity", async () => {
  const skillFile = await writeSkill(".claude", "barely", "A heavy helper used once.");
  await setMtime(skillFile, 30);
  await writeClaudeUserMessage("please run /barely now", new Date(Date.now() - 2 * DAY).toISOString());

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  const finding = lowUsage(run, "barely");
  expect(finding?.severity).toBe("medium");
  expect(finding?.metrics).toMatchObject({ uses: 1 });
});

test("persists a run, exposes it by id, and prunes history to the limit", async () => {
  const skillFile = await writeSkill(".claude", "bloated", "A large helper nobody calls.");
  await setMtime(skillFile, 30);

  // Seed 52 old snapshots so the next run forces a prune (HISTORY_LIMIT = 50).
  const dir = path.join(tmp, ".skill-toggle", "diagnostics");
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < 52; i += 1) {
    const stamp = `2020-01-01T00-00-${String(i).padStart(2, "0")}-000Z`;
    await fs.writeFile(path.join(dir, `${stamp}.json`), JSON.stringify({ id: stamp, createdAt: stamp, overlapMethod: "lexical", counts: { high: 0, medium: 0, low: 0 }, findings: [] }));
  }

  const { createDiagnosticsRun, listDiagnosticsRuns, getDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");

  const fetched = await getDiagnosticsRun(run.id);
  expect(fetched?.findings).toEqual(run.findings);

  const history = await listDiagnosticsRuns();
  expect(history.length).toBe(50);
  expect(history[0].id).toBe(run.id); // newest first
  expect(history[0].counts.high).toBe(1);
});

test("flags overlapping same-category skills with shared terms (lexical)", async () => {
  await writeSkill(".claude", "pytest-runner", "Run pytest unit tests for python testing", 50);
  await writeSkill(".claude", "python-tester", "Run python pytest unit testing suites", 50);

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  const overlap = run.findings.find((f) => f.ruleId === "overlap");

  expect(overlap?.items.map((i) => i.name).sort()).toEqual(["pytest-runner", "python-tester"]);
  expect(Number(overlap?.metrics.jaccard)).toBeGreaterThanOrEqual(0.4);
  expect(overlap?.detail.toLowerCase()).toContain("shared terms");
  expect(overlap?.actions.filter((a) => a.type === "disable").length).toBe(2);
});

test("does not flag the same skill installed under multiple providers as overlap", async () => {
  // Identical name + description, just installed in two homes — a duplicate
  // install, not two competing different skills.
  await writeSkill(".claude", "office-hours", "Brainstorm product ideas in structured office hours", 50);
  await writeSkill(".agents", "office-hours", "Brainstorm product ideas in structured office hours", 50);

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  expect(run.findings.some((f) => f.ruleId === "overlap")).toBe(false);
});

test("reports a name-pair overlap once even when copies exist in multiple homes", async () => {
  await writeSkill(".claude", "alpha-helper", "manage jira tickets and issues", 50);
  await writeSkill(".agents", "alpha-helper", "manage jira tickets and issues", 50);
  await writeSkill(".claude", "beta-helper", "manage jira issues and tickets workflow", 50);
  await writeSkill(".agents", "beta-helper", "manage jira issues and tickets workflow", 50);

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  const overlaps = run.findings.filter((f) => f.ruleId === "overlap");

  expect(overlaps.length).toBe(1);
  expect(overlaps[0].items.map((i) => i.name).sort()).toEqual(["alpha-helper", "beta-helper"]);
});

test("does not pair unrelated items or cross-category lookalikes", async () => {
  await writeSkill(".claude", "weather-fetch", "Fetch local weather forecasts by zip code", 50);
  await writeSkill(".claude", "invoice-pdf", "Generate billing invoices as printable documents", 50);
  // Same wording as a skill, but lives in agents — different category, must not pair.
  const agentFile = path.join(tmp, ".claude", "agents", "weather-agent.md");
  await fs.mkdir(path.dirname(agentFile), { recursive: true });
  await fs.writeFile(agentFile, "---\nname: weather-agent\ndescription: Fetch local weather forecasts by zip code\n---\nx\n");

  const { createDiagnosticsRun } = await import("../server/diagnostics");
  const run = await createDiagnosticsRun("lexical");
  expect(run.findings.some((f) => f.ruleId === "overlap")).toBe(false);
});

test("does not diagnose disabled items", async () => {
  const skillFile = await writeSkill(".claude", "parked", "Heavy but turned off.");
  await setMtime(skillFile, 30);

  const { createDiagnosticsRun, listDiagnosticsRuns } = await import("../server/diagnostics");
  const { listInventory, toggleItem } = await import("../server/discovery");
  const item = (await listInventory()).find((row) => row.name === "parked");
  await toggleItem(item!.id, false);

  const run = await createDiagnosticsRun("lexical");
  expect(lowUsage(run, "parked")).toBeUndefined();
  // sanity: the run was persisted and is discoverable.
  expect((await listDiagnosticsRuns()).some((r) => r.id === run.id)).toBe(true);
});
