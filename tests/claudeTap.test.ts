import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const execFileAsync = promisify(execFile);
let tmp = "";
let oldCloudtapDb: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-tap-"));
  oldCloudtapDb = process.env.CLOUDTAP_DB;
  process.env.CLOUDTAP_DB = path.join(tmp, "traces.sqlite3");
  vi.resetModules();
});

afterEach(async () => {
  if (oldCloudtapDb === undefined) delete process.env.CLOUDTAP_DB;
  else process.env.CLOUDTAP_DB = oldCloudtapDb;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("reads claude-tap sqlite summaries and extracts codex workspace metadata", async () => {
  await sqlite(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      date_key TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      proxy_mode TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      record_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT,
      legacy_source_key TEXT NOT NULL DEFAULT '',
      legacy_rel_path TEXT
    );
    CREATE TABLE records (
      session_id TEXT NOT NULL,
      record_index INTEGER NOT NULL,
      turn INTEGER,
      timestamp TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (session_id, record_index)
    );
    CREATE TABLE migration_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await sqlite("INSERT INTO migration_state (key, value) VALUES ('schema_version', '4')");
  await sqlite(
    `INSERT INTO sessions (
      id, started_at, updated_at, date_key, client, proxy_mode, status, record_count, summary_json
    ) VALUES (
      's1',
      '2026-06-05T00:00:00.000Z',
      '2026-06-05T00:01:00.000Z',
      '2026-06-05',
      'codex',
      'reverse',
      'complete',
      1,
      ${sqlString(JSON.stringify({
      agent: "Codex",
      agent_key: "codex",
      model: "gpt-5.4-mini",
      turn_count: 1,
      duration_ms: 2500,
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_create_tokens: 10,
      total_tokens: 160,
      first_user: "hello"
      }))}
    )`
  );
  await sqlite(
    `INSERT INTO records (session_id, record_index, turn, timestamp, payload_json)
     VALUES (
      's1',
      1,
      1,
      '2026-06-05T00:00:05.000Z',
      ${sqlString(JSON.stringify({
      record: {
        request: {
          body: {
            instructions: "### Available skills\n- planner: Planning helper (file: r0/planner/SKILL.md)\n",
            input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "please use planner" }] }]
          },
          headers: {
            "x-codex-turn-metadata": JSON.stringify({
              workspaces: {
                "/tmp/workspace": { has_changes: true }
              }
            })
          }
        }
      }
      }))}
    )`
  );

  const { getClaudeTapOverview, getClaudeTapSessionDetail } = await import("../server/claudeTap");
  const overview = await getClaudeTapOverview();
  const detail = await getClaudeTapSessionDetail("s1");

  expect(overview.source).toEqual(expect.objectContaining({
    available: true,
    schemaVersion: 4,
    sessionCount: 1,
    recordCount: 1
  }));
  expect(overview.sessions[0]).toEqual(expect.objectContaining({
    id: "s1",
    workspace: "/tmp/workspace",
    totalTokens: 160,
    firstUser: "hello",
    cost: expect.objectContaining({ pricingStatus: "priced" }),
    skillActivity: expect.objectContaining({ loadedCount: 0, mentionedCount: 0 })
  }));
  expect(overview.budget).toEqual(expect.objectContaining({
    totalTokens: 160,
    uncachedInputTokens: 80,
    pricedSessions: 1
  }));
  expect(overview.sessions[0].cost.pricing?.model).toBe("gpt-5.4-mini");
  expect(detail?.skillActivity).toEqual(expect.objectContaining({ loadedCount: 1, mentionedCount: 1 }));
  expect(detail?.skillActivity.loadedSkills[0]).toEqual(expect.objectContaining({ name: "planner" }));
  expect(overview.byModel[0]).toEqual(expect.objectContaining({ key: "gpt-5.4-mini", totalTokens: 160 }));
});

test("prices Claude sessions using dash-form model ids from transcripts", async () => {
  await sqlite(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      date_key TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      proxy_mode TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      record_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT,
      legacy_source_key TEXT NOT NULL DEFAULT '',
      legacy_rel_path TEXT
    );
    CREATE TABLE records (
      session_id TEXT NOT NULL,
      record_index INTEGER NOT NULL,
      turn INTEGER,
      timestamp TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (session_id, record_index)
    );
    CREATE TABLE migration_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await sqlite("INSERT INTO migration_state (key, value) VALUES ('schema_version', '4')");
  await sqlite(
    `INSERT INTO sessions (
      id, started_at, updated_at, date_key, client, proxy_mode, status, record_count, summary_json
    ) VALUES (
      'c1',
      '2026-06-05T00:00:00.000Z',
      '2026-06-05T00:01:00.000Z',
      '2026-06-05',
      'claude',
      'reverse',
      'complete',
      0,
      ${sqlString(JSON.stringify({
      agent: "Claude Code",
      agent_key: "claude",
      model: "claude-opus-4-8",
      turn_count: 1,
      duration_ms: 2500,
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      total_tokens: 2_000_000,
      first_user: "hi"
      }))}
    )`
  );

  const { getClaudeTapOverview } = await import("../server/claudeTap");
  const overview = await getClaudeTapOverview();
  const cost = overview.sessions[0].cost;

  expect(cost.pricingStatus).toBe("priced");
  expect(cost.pricing?.model).toBe("claude-opus-4-8");
  // 1M input @ $5 + 1M output @ $25
  expect(cost.estimatedUsd).toBeCloseTo(30, 6);
  expect(overview.budget.pricedSessions).toBe(1);
  expect(overview.budget.unpricedSessions).toBe(0);
});

test("extracts loaded skills from Claude sessions (top-level record, no envelope)", async () => {
  await sqlite(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      date_key TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      proxy_mode TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      record_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT,
      legacy_source_key TEXT NOT NULL DEFAULT '',
      legacy_rel_path TEXT
    );
    CREATE TABLE records (
      session_id TEXT NOT NULL,
      record_index INTEGER NOT NULL,
      turn INTEGER,
      timestamp TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (session_id, record_index)
    );
    CREATE TABLE migration_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await sqlite("INSERT INTO migration_state (key, value) VALUES ('schema_version', '4')");
  await sqlite(
    `INSERT INTO sessions (
      id, started_at, updated_at, date_key, client, proxy_mode, status, record_count, summary_json
    ) VALUES (
      'cl1',
      '2026-06-05T00:00:00.000Z',
      '2026-06-05T00:01:00.000Z',
      '2026-06-05',
      'claude',
      'reverse',
      'complete',
      1,
      ${sqlString(JSON.stringify({
      agent: "Claude Code",
      agent_key: "claude",
      model: "claude-opus-4-8",
      turn_count: 1,
      duration_ms: 2500,
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      first_user: "please use planner"
      }))}
    )`
  );
  // Claude stores the captured request at the top level — no `record` envelope.
  await sqlite(
    `INSERT INTO records (session_id, record_index, turn, timestamp, payload_json)
     VALUES (
      'cl1',
      1,
      1,
      '2026-06-05T00:00:05.000Z',
      ${sqlString(JSON.stringify({
      timestamp: "2026-06-05T00:00:05.000Z",
      request: {
        body: {
          model: "claude-opus-4-8",
          system: [{ type: "text", text: "You are Claude Code." }],
          messages: [
            { role: "user", content: "please use planner" },
            {
              role: "user",
              content:
                "The following skills are available for use with the Skill tool:\n\n- planner: Planning helper\n- investigate: Bug investigation helper\n"
            }
          ]
        }
      }
      }))}
    )`
  );

  const { getClaudeTapSessionDetail } = await import("../server/claudeTap");
  const detail = await getClaudeTapSessionDetail("cl1");

  expect(detail?.skillActivity.loadedCount).toBe(2);
  expect(detail?.skillActivity.loadedSkills.map((s) => s.name)).toEqual(["investigate", "planner"]);
  // "planner" appears in the first user message → counted as a mention.
  expect(detail?.skillActivity.mentionedSkills.map((s) => s.name)).toContain("planner");
});

async function sqlite(sql: string) {
  await execFileAsync("sqlite3", [process.env.CLOUDTAP_DB!, sql]);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
