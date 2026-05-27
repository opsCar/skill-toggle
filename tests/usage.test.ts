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

test("context probe summarizes enabled baseline by tool and category", async () => {
  const codexRule = path.join(tmp, ".codex", "AGENTS.md");
  const codexSkill = path.join(tmp, ".codex", "skills", "planner", "SKILL.md");
  const claudeRule = path.join(tmp, ".claude", "CLAUDE.md");
  await fs.mkdir(path.dirname(codexSkill), { recursive: true });
  await fs.mkdir(path.dirname(claudeRule), { recursive: true });
  await fs.writeFile(codexRule, "Use concise answers.\n");
  await fs.writeFile(codexSkill, "---\nname: planner\ndescription: Planning helper\n---\nPlan carefully.\n");
  await fs.writeFile(claudeRule, "Prefer tests.\n");

  const { listInventory, toggleItem } = await import("../server/discovery");
  const { getContextProbe } = await import("../server/usage");
  const ruleItem = (await listInventory()).find((item) => item.tool === "codex" && item.category === "rules" && item.name === "AGENTS");
  await toggleItem(ruleItem!.id, false);

  const probe = getContextProbe(await listInventory(), "hello");
  const codex = probe.tools.find((tool) => tool.tool === "codex")!;
  const claude = probe.tools.find((tool) => tool.tool === "claude")!;

  expect(probe.prompt).toBe("hello");
  expect(codex.promptTokens).toBe(2);
  expect(codex.enabledItems).toBe(1);
  expect(codex.breakdown).toEqual([
    expect.objectContaining({ category: "skills", items: 1 })
  ]);
  expect(codex.topContributors[0]).toEqual(expect.objectContaining({ name: "planner", category: "skills" }));
  expect(codex.estimatedTotalTokens).toBe(codex.estimatedContextTokens + 2);
  expect(claude.breakdown).toEqual([
    expect.objectContaining({ category: "rules", items: 1 })
  ]);
});

test("startup probe picks latest session by embedded timestamp and includes Claude startup attachments", async () => {
  const projectRoot = path.join(tmp, ".claude", "projects", "project");
  await fs.mkdir(projectRoot, { recursive: true });
  const staleFile = path.join(projectRoot, "stale.jsonl");
  const freshFile = path.join(projectRoot, "fresh.jsonl");
  const staleRows = [
    { type: "user", isMeta: true, cwd: process.cwd(), timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "stale meta" } },
    { type: "user", cwd: process.cwd(), timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "stale prompt" } },
    { type: "assistant", cwd: process.cwd(), timestamp: "2026-01-01T00:00:02.000Z", message: { usage: { input_tokens: 1 } } }
  ];
  const freshRows = [
    { type: "user", isMeta: true, cwd: process.cwd(), timestamp: "2026-01-02T00:00:00.000Z", message: { role: "user", content: "fresh meta" } },
    { type: "user", cwd: process.cwd(), timestamp: "2026-01-02T00:00:01.000Z", message: { role: "user", content: "hello" } },
    { type: "attachment", cwd: process.cwd(), timestamp: "2026-01-02T00:00:01.000Z", attachment: { type: "deferred_tools_delta", addedNames: ["Read", "Write"] } },
    { type: "attachment", cwd: process.cwd(), timestamp: "2026-01-02T00:00:01.000Z", attachment: { type: "skill_listing", content: "- planner: Plan carefully. (gstack)\n", skillCount: 1, names: ["planner"], isInitial: true } },
    { type: "attachment", cwd: process.cwd(), timestamp: "2026-01-02T00:00:01.000Z", attachment: { type: "mcp_instructions_delta", addedBlocks: ["## docs\nUse docs."], addedNames: ["docs"] } },
    { type: "assistant", cwd: process.cwd(), timestamp: "2026-01-02T00:00:02.000Z", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 5 } } }
  ];
  await fs.writeFile(staleFile, staleRows.map((row) => JSON.stringify(row)).join("\n"));
  await fs.writeFile(freshFile, freshRows.map((row) => JSON.stringify(row)).join("\n"));
  await fs.utimes(staleFile, new Date("2026-01-03T00:00:00.000Z"), new Date("2026-01-03T00:00:00.000Z"));
  await fs.utimes(freshFile, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

  const { getStartupProbe } = await import("../server/usage");
  const claude = (await getStartupProbe()).tools.find((tool) => tool.tool === "claude")!;

  expect(claude.sessionPath).toBe(freshFile);
  expect(claude.timestamp).toBe("2026-01-02T00:00:02.000Z");
  expect(claude.totalInputTokens).toBe(10);
  expect(claude.components).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "tool_registry", count: 2 }),
    expect.objectContaining({ kind: "skill_registry", count: 1 }),
    expect.objectContaining({ kind: "mcp_instructions" })
  ]));
});

test("startup probe falls back to latest Codex session when none match the workspace", async () => {
  const sessionRoot = path.join(tmp, ".codex", "sessions", "2026", "01", "02");
  await fs.mkdir(sessionRoot, { recursive: true });
  const sessionFile = path.join(sessionRoot, "rollout.jsonl");
  const rows = [
    { type: "session_meta", payload: { cwd: path.join(tmp, "outside-workspace"), timestamp: "2026-01-02T00:00:00.000Z", base_instructions: { text: "Base instructions" } } },
    { type: "response_item", payload: { type: "message", timestamp: "2026-01-02T00:00:01.000Z", content: [{ type: "input_text", text: "startup context" }] } },
    { type: "event_msg", payload: { type: "user_message", timestamp: "2026-01-02T00:00:02.000Z", message: "hello" } }
  ];
  await fs.writeFile(sessionFile, rows.map((row) => JSON.stringify(row)).join("\n"));

  const { getStartupProbe } = await import("../server/usage");
  const codex = (await getStartupProbe()).tools.find((tool) => tool.tool === "codex")!;

  expect(codex.sessionPath).toBe(sessionFile);
  expect(codex.cwd).toBe(path.join(tmp, "outside-workspace"));
  expect(codex.warning).toContain("no session for this workspace");
  expect(codex.components).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "base_instructions" }),
    expect.objectContaining({ label: "Injected startup message" })
  ]));
});
