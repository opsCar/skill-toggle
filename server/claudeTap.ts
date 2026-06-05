import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SKILL_RECORD_SAMPLE_LIMIT = 3;

export interface ClaudeTapSourceInfo {
  available: boolean;
  dbPath: string;
  schemaVersion?: number;
  sizeBytes?: number;
  tables: string[];
  sessionCount: number;
  recordCount: number;
  warning?: string;
}

export interface ClaudeTapSession {
  id: string;
  startedAt: string;
  updatedAt: string;
  date: string;
  client: string;
  agent: string;
  agentKey: string;
  proxyMode: string;
  status: string;
  active: boolean;
  live: boolean;
  model: string;
  workspace?: string;
  recordCount: number;
  turnCount: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
  cost: ClaudeTapCostEstimate;
  firstUser: string;
  lastResponse: string;
  error: string;
  skillActivity: ClaudeTapSkillActivity;
  legacyRelPath?: string;
}

export interface ClaudeTapSkillSignal {
  name: string;
  description?: string;
  count: number;
  evidence: string[];
}

export interface ClaudeTapSkillActivity {
  loadedCount: number;
  mentionedCount: number;
  loadedSkills: ClaudeTapSkillSignal[];
  mentionedSkills: ClaudeTapSkillSignal[];
}

export interface ClaudeTapBudgetSummary {
  sessions: number;
  records: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
  uncachedInputTokens: number;
  cacheReadRatio: number;
  avgTokensPerSession: number;
  estimatedCostUsd: number;
  pricedSessions: number;
  unpricedSessions: number;
}

export interface ClaudeTapBreakdownRow {
  key: string;
  sessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export interface ClaudeTapModelPricing {
  model: string;
  provider: "openai" | "anthropic";
  inputPerMTok: number;
  cachedInputPerMTok?: number;
  cacheWritePerMTok?: number;
  outputPerMTok: number;
  source: string;
}

export interface ClaudeTapCostEstimate {
  estimatedUsd: number;
  inputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  pricing?: ClaudeTapModelPricing;
  pricingStatus: "priced" | "unknown-model";
}

export interface ClaudeTapOverview {
  generatedAt: string;
  source: ClaudeTapSourceInfo;
  budget: ClaudeTapBudgetSummary;
  sessions: ClaudeTapSession[];
  byAgent: ClaudeTapBreakdownRow[];
  byModel: ClaudeTapBreakdownRow[];
  pricing: {
    generatedAt: string;
    note: string;
    sources: Array<{ provider: string; url: string; checkedAt: string }>;
  };
}

interface SessionRow {
  id: string;
  started_at: string;
  updated_at: string;
  date_key: string;
  client: string;
  proxy_mode: string;
  status: string;
  record_count: number;
  summary_json: string | null;
  legacy_rel_path: string | null;
}

export function resolveClaudeTapDbPath(): string {
  const override = process.env.CLOUDTAP_DB?.trim();
  if (override) return path.resolve(expandHome(override));
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  const base = xdgData ? path.join(expandHome(xdgData), "claude-tap") : path.join(os.homedir(), ".local", "share", "claude-tap");
  return path.join(base, "traces.sqlite3");
}

export async function getClaudeTapOverview(limit = 120): Promise<ClaudeTapOverview> {
  const dbPath = resolveClaudeTapDbPath();
  const source = emptySource(dbPath);
  if (!fs.existsSync(dbPath)) {
    return emptyOverview({ ...source, warning: "claude-tap trace database was not found." });
  }

  const stat = fs.statSync(dbPath);
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const tableRows = await sqliteJson<{ name: string }>(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const tableNames = tableRows.map((row) => row.name);
  const schemaVersion = await readSchemaVersion(dbPath);
  const sessionCount = await countRows(dbPath, "sessions");
  const recordCount = await countRows(dbPath, "records");
  const rows = await sqliteJson<SessionRow>(
    dbPath,
    `SELECT id, started_at, updated_at, date_key, client, proxy_mode, status, record_count, summary_json, legacy_rel_path
     FROM sessions
     ORDER BY updated_at DESC
     LIMIT ${safeLimit}`
  );
  const sessions = await Promise.all(rows.map((row) => rowToSession(dbPath, row, false)));
  const budget = summarize(sessions, sessionCount, recordCount);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      available: true,
      dbPath,
      schemaVersion,
      sizeBytes: stat.size,
      tables: tableNames,
      sessionCount,
      recordCount
    },
    budget,
    sessions,
    byAgent: breakdown(sessions, (session) => session.agent || session.client || "unknown"),
    byModel: breakdown(sessions, (session) => session.model || "unknown"),
    pricing: pricingMetadata()
  };
}

export async function getClaudeTapSessionDetail(sessionId: string): Promise<ClaudeTapSession | null> {
  const dbPath = resolveClaudeTapDbPath();
  if (!fs.existsSync(dbPath)) return null;
  const [row] = await sqliteJson<SessionRow>(
    dbPath,
    `SELECT id, started_at, updated_at, date_key, client, proxy_mode, status, record_count, summary_json, legacy_rel_path
     FROM sessions
     WHERE id = ${sqlString(sessionId)}
     LIMIT 1`
  );
  return row ? rowToSession(dbPath, row, true) : null;
}

function emptySource(dbPath: string): ClaudeTapSourceInfo {
  return { available: false, dbPath, tables: [], sessionCount: 0, recordCount: 0 };
}

function emptyOverview(source: ClaudeTapSourceInfo): ClaudeTapOverview {
  return {
    generatedAt: new Date().toISOString(),
    source,
    budget: summarize([], 0, 0),
    sessions: [],
    byAgent: [],
    byModel: [],
    pricing: pricingMetadata()
  };
}

function expandHome(input: string): string {
  return input === "~" || input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

async function readSchemaVersion(dbPath: string): Promise<number | undefined> {
  try {
    const [row] = await sqliteJson<{ value?: string }>(dbPath, "SELECT value FROM migration_state WHERE key = 'schema_version'");
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function countRows(dbPath: string, table: string): Promise<number> {
  try {
    const [row] = await sqliteJson<{ count: number }>(dbPath, `SELECT COUNT(*) AS count FROM ${table}`);
    return Number(row.count) || 0;
  } catch {
    return 0;
  }
}

async function rowToSession(dbPath: string, row: SessionRow, includeSkills: boolean): Promise<ClaudeTapSession> {
  const summary = parseObject(row.summary_json);
  const startedAt = asString(summary.started_at) || row.started_at;
  const updatedAt = asString(summary.updated_at) || row.updated_at;
  const client = asString(row.client) || asString(summary.agent_key) || "unknown";
  const workspace = await workspaceForSession(dbPath, row.id);
  const tokenStats = {
    inputTokens: asNumber(summary.input_tokens, 0),
    outputTokens: asNumber(summary.output_tokens, 0),
    cacheReadTokens: asNumber(summary.cache_read_tokens, 0),
    cacheCreateTokens: asNumber(summary.cache_create_tokens, 0)
  };
  const model = asString(summary.model) || "unknown";
  return {
    id: row.id,
    startedAt,
    updatedAt,
    date: asString(summary.date) || row.date_key,
    client,
    agent: asString(summary.agent) || labelClient(client),
    agentKey: asString(summary.agent_key) || client,
    proxyMode: row.proxy_mode || "unknown",
    status: row.status || asString(summary.status) || "unknown",
    active: asBoolean(summary.active),
    live: asBoolean(summary.live),
    model,
    workspace,
    recordCount: asNumber(summary.record_count, row.record_count),
    turnCount: asNumber(summary.turn_count, row.record_count),
    durationMs: asNumber(summary.duration_ms, 0),
    ...tokenStats,
    totalTokens: asNumber(summary.total_tokens, 0),
    cost: estimateCost(model, tokenStats),
    firstUser: asString(summary.first_user),
    lastResponse: asString(summary.last_response),
    error: asString(summary.error),
    skillActivity: includeSkills ? await skillActivityForSession(dbPath, row.id) : emptySkillActivity(),
    legacyRelPath: row.legacy_rel_path ?? undefined
  };
}

async function workspaceForSession(dbPath: string, sessionId: string): Promise<string | undefined> {
  try {
    const rows = await sqliteJson<{ payload_json: string }>(
      dbPath,
      `SELECT payload_json FROM records
       WHERE session_id = ${sqlString(sessionId)}
       ORDER BY record_index ASC
       LIMIT 6`
    );
    for (const row of rows) {
      const record = recordFromPayload(row.payload_json);
      const headers = parseObject(parseObject(record.request)?.headers);
      const metadata = parseObject(headers["x-codex-turn-metadata"]);
      const workspaces = parseObject(metadata.workspaces);
      const firstWorkspace = Object.keys(workspaces)[0];
      if (firstWorkspace) return firstWorkspace;
      const cwd = asString(metadata.cwd);
      if (cwd) return cwd;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function skillActivityForSession(dbPath: string, sessionId: string): Promise<ClaudeTapSkillActivity> {
  try {
    const rows = await sqliteJson<{ record_index: number; timestamp: string | null; payload_json: string }>(
      dbPath,
      `SELECT record_index, timestamp, payload_json FROM records
       WHERE session_id = ${sqlString(sessionId)}
       ORDER BY record_index ASC
       LIMIT ${SKILL_RECORD_SAMPLE_LIMIT}`
    );
    const parsedRows = rows.map((row) => {
      return { row, record: recordFromPayload(row.payload_json) };
    });
    const blobHashes = new Set<string>();
    for (const { record } of parsedRows) {
      const bodies = [parseObject(parseObject(record.request)?.body), parseObject(parseObject(record.response)?.body)];
      for (const body of bodies) {
        const ref = blobRef(body.instructions);
        if (ref) blobHashes.add(ref);
      }
    }
    const blobs = await readBlobTextMap(dbPath, sessionId, [...blobHashes]);
    const loaded = new Map<string, ClaudeTapSkillSignal>();
    const conversationTexts: string[] = [];

    for (const { row, record } of parsedRows) {
      const stamp = row.timestamp || asString(record.timestamp) || `record ${row.record_index}`;
      const bodies = [parseObject(parseObject(record.request)?.body), parseObject(parseObject(record.response)?.body)];

      for (const body of bodies) {
        for (const text of registryTextsForBody(body, blobs)) {
          for (const skill of extractLoadedSkills(text)) {
            addSignal(loaded, skill.name, {
              description: skill.description,
              evidence: `loaded registry · ${stamp}`
            });
          }
        }
        collectConversationText(body, conversationTexts);
      }
    }

    const mentioned = mentionedSignals([...loaded.keys()], conversationTexts.join("\n"));
    const loadedSkills = [...loaded.values()].sort((a, b) => a.name.localeCompare(b.name));
    const mentionedSkills = [...mentioned.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      loadedCount: loadedSkills.length,
      mentionedCount: mentionedSkills.length,
      loadedSkills: loadedSkills.slice(0, 80),
      mentionedSkills: mentionedSkills.slice(0, 40)
    };
  } catch {
    return emptySkillActivity();
  }
}

function emptySkillActivity(): ClaudeTapSkillActivity {
  return { loadedCount: 0, mentionedCount: 0, loadedSkills: [], mentionedSkills: [] };
}

function registryTextsForBody(body: Record<string, any>, blobs: Map<string, string>): string[] {
  const texts: string[] = [];
  const direct = body.instructions;
  if (typeof direct === "string") texts.push(direct);
  const ref = blobRef(direct);
  if (ref) texts.push(blobs.get(ref) ?? "");
  for (const text of messageTextsFromValue(body.input)) {
    if (looksLikeSkillRegistry(text)) texts.push(text);
  }
  for (const text of messageTextsFromValue(body.messages)) {
    if (looksLikeSkillRegistry(text)) texts.push(text);
  }
  return texts.filter(Boolean);
}

function collectConversationText(value: unknown, out: string[]) {
  for (const text of messageTextsFromValue(value)) {
    if (!looksLikeSkillRegistry(text)) out.push(text);
  }
}

function messageTextsFromValue(value: unknown): string[] {
  const texts: string[] = [];
  const visit = (entry: unknown) => {
    if (!entry) return;
    if (typeof entry === "string") {
      texts.push(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
      return;
    }
    if (typeof entry !== "object") return;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.text === "string") texts.push(obj.text);
    if (typeof obj.content === "string") texts.push(obj.content);
    else if (Array.isArray(obj.content)) visit(obj.content);
    if (Array.isArray(obj.input)) visit(obj.input);
    if (Array.isArray(obj.messages)) visit(obj.messages);
    if (Array.isArray(obj.output)) visit(obj.output);
  };
  visit(value);
  return texts;
}

function extractLoadedSkills(text: string): Array<{ name: string; description?: string }> {
  const rows: Array<{ name: string; description?: string }> = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+([A-Za-z0-9_.:@/-]+):\s+(.+?)(?:\s+\(file:\s*.+\))?\s*$/);
    if (!match) continue;
    const name = match[1].trim();
    if (!isSkillLikeName(name) || seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, description: match[2].trim() });
  }
  return rows;
}

function mentionedSignals(names: string[], text: string): Map<string, ClaudeTapSkillSignal> {
  const signals = new Map<string, ClaudeTapSkillSignal>();
  if (!text.trim()) return signals;
  for (const name of names) {
    const escaped = escapeRegex(name);
    const regex = new RegExp(`(^|[^A-Za-z0-9_.:@/-])(${escaped})(?=$|[^A-Za-z0-9_.:@/-])`, "gi");
    const matches = [...text.matchAll(regex)];
    if (!matches.length) continue;
    addSignal(signals, name, {
      count: matches.length,
      evidence: `${matches.length} mention${matches.length === 1 ? "" : "s"} in sampled request/response text`
    });
  }
  return signals;
}

function addSignal(
  map: Map<string, ClaudeTapSkillSignal>,
  name: string,
  options: { description?: string; count?: number; evidence: string }
) {
  const signal = map.get(name) ?? { name, description: options.description, count: 0, evidence: [] };
  signal.count += options.count ?? 1;
  if (!signal.description && options.description) signal.description = options.description;
  if (signal.evidence.length < 3 && !signal.evidence.includes(options.evidence)) signal.evidence.push(options.evidence);
  map.set(name, signal);
}

function looksLikeSkillRegistry(text: string): boolean {
  return (
    text.includes("### Available skills") ||
    text.includes("### Skills") ||
    text.includes("Available skills") ||
    // Claude Code injects the registry with this exact phrasing.
    text.includes("are available for use with the Skill tool")
  );
}

function isSkillLikeName(name: string): boolean {
  return name.length > 1 && !name.includes("__") && !/^(http|https|file)$/i.test(name);
}

function blobRef(value: unknown): string | undefined {
  const ref = parseObject(value).__claude_tap_blob_ref__;
  const hash = parseObject(ref).hash;
  return typeof hash === "string" ? hash : undefined;
}

async function readBlobTextMap(dbPath: string, sessionId: string, hashes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (hashes.length === 0) return map;
  const rows = await sqliteJson<{ hash: string; payload_json: string }>(
    dbPath,
    `SELECT hash, payload_json FROM record_blobs
     WHERE session_id = ${sqlString(sessionId)}
       AND hash IN (${hashes.map(sqlString).join(",")})`
  );
  for (const row of rows) {
    const parsed = parseAny(row.payload_json);
    map.set(row.hash, typeof parsed === "string" ? parsed : JSON.stringify(parsed));
  }
  return map;
}

function parseAny(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], { maxBuffer: 16 * 1024 * 1024 });
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function summarize(sessions: ClaudeTapSession[], totalSessions: number, totalRecords: number): ClaudeTapBudgetSummary {
  const inputTokens = sum(sessions, (session) => session.inputTokens);
  const outputTokens = sum(sessions, (session) => session.outputTokens);
  const cacheReadTokens = sum(sessions, (session) => session.cacheReadTokens);
  const cacheCreateTokens = sum(sessions, (session) => session.cacheCreateTokens);
  const totalTokens = sum(sessions, (session) => session.totalTokens);
  const estimatedCostUsd = sum(sessions, (session) => session.cost.estimatedUsd);
  const pricedSessions = sessions.filter((session) => session.cost.pricingStatus === "priced").length;
  const uncachedInputTokens = Math.max(0, inputTokens + cacheCreateTokens - cacheReadTokens);
  return {
    sessions: totalSessions || sessions.length,
    records: totalRecords || sum(sessions, (session) => session.recordCount),
    durationMs: sum(sessions, (session) => session.durationMs),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    totalTokens,
    uncachedInputTokens,
    cacheReadRatio: totalTokens > 0 ? cacheReadTokens / totalTokens : 0,
    avgTokensPerSession: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
    estimatedCostUsd,
    pricedSessions,
    unpricedSessions: Math.max(0, sessions.length - pricedSessions)
  };
}

function breakdown(sessions: ClaudeTapSession[], keyFor: (session: ClaudeTapSession) => string): ClaudeTapBreakdownRow[] {
  const byKey = new Map<string, ClaudeTapBreakdownRow>();
  for (const session of sessions) {
    const key = keyFor(session) || "unknown";
    const row = byKey.get(key) ?? {
      key,
      sessions: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      durationMs: 0,
      estimatedCostUsd: 0
    };
    row.sessions += 1;
    row.totalTokens += session.totalTokens;
    row.inputTokens += session.inputTokens;
    row.outputTokens += session.outputTokens;
    row.cacheReadTokens += session.cacheReadTokens;
    row.cacheCreateTokens += session.cacheCreateTokens;
    row.durationMs += session.durationMs;
    row.estimatedCostUsd += session.cost.estimatedUsd;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 12);
}

const PRICING: ClaudeTapModelPricing[] = [
  { model: "gpt-5.5", provider: "openai", inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 30, source: "OpenAI API pricing (standard, short context)" },
  { model: "gpt-5.5-pro", provider: "openai", inputPerMTok: 30, outputPerMTok: 180, source: "OpenAI API pricing (standard, short context)" },
  { model: "gpt-5.4", provider: "openai", inputPerMTok: 2.5, cachedInputPerMTok: 0.25, outputPerMTok: 15, source: "OpenAI API pricing (standard, short context)" },
  { model: "gpt-5.4-mini", provider: "openai", inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 4.5, source: "OpenAI API pricing (standard, short context)" },
  { model: "gpt-5.4-nano", provider: "openai", inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1.25, source: "OpenAI API pricing (standard, short context)" },
  { model: "gpt-5.4-pro", provider: "openai", inputPerMTok: 30, outputPerMTok: 180, source: "OpenAI API pricing (standard, short context)" },
  { model: "chatgpt chat-latest", provider: "openai", inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 30, source: "OpenAI API pricing" },
  { model: "gpt-5.3-codex", provider: "openai", inputPerMTok: 1.75, cachedInputPerMTok: 0.175, outputPerMTok: 14, source: "OpenAI API pricing" },
  { model: "claude-opus-4-8", provider: "anthropic", inputPerMTok: 5, cacheWritePerMTok: 6.25, cachedInputPerMTok: 0.5, outputPerMTok: 25, source: "Anthropic Claude pricing" },
  { model: "claude-opus-4-7", provider: "anthropic", inputPerMTok: 5, cacheWritePerMTok: 6.25, cachedInputPerMTok: 0.5, outputPerMTok: 25, source: "Anthropic Claude pricing" },
  { model: "claude-opus-4-6", provider: "anthropic", inputPerMTok: 5, cacheWritePerMTok: 6.25, cachedInputPerMTok: 0.5, outputPerMTok: 25, source: "Anthropic Claude pricing" },
  { model: "claude-opus-4-5", provider: "anthropic", inputPerMTok: 5, cacheWritePerMTok: 6.25, cachedInputPerMTok: 0.5, outputPerMTok: 25, source: "Anthropic Claude pricing" },
  { model: "claude-opus-4-1", provider: "anthropic", inputPerMTok: 15, cacheWritePerMTok: 18.75, cachedInputPerMTok: 1.5, outputPerMTok: 75, source: "Anthropic Claude pricing" },
  { model: "claude-sonnet-4-6", provider: "anthropic", inputPerMTok: 3, cacheWritePerMTok: 3.75, cachedInputPerMTok: 0.3, outputPerMTok: 15, source: "Anthropic Claude pricing" },
  { model: "claude-sonnet-4-5", provider: "anthropic", inputPerMTok: 3, cacheWritePerMTok: 3.75, cachedInputPerMTok: 0.3, outputPerMTok: 15, source: "Anthropic Claude pricing" },
  { model: "claude-haiku-4-5", provider: "anthropic", inputPerMTok: 1, cacheWritePerMTok: 1.25, cachedInputPerMTok: 0.1, outputPerMTok: 5, source: "Anthropic Claude pricing" },
  { model: "claude-haiku-3-5", provider: "anthropic", inputPerMTok: 0.8, cacheWritePerMTok: 1, cachedInputPerMTok: 0.08, outputPerMTok: 4, source: "Anthropic Claude pricing" }
];

function estimateCost(
  model: string,
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number }
): ClaudeTapCostEstimate {
  const pricing = pricingForModel(model);
  if (!pricing) {
    return { estimatedUsd: 0, inputUsd: 0, cachedInputUsd: 0, cacheWriteUsd: 0, outputUsd: 0, pricingStatus: "unknown-model" };
  }
  const inputUsd = tokens.inputTokens * pricing.inputPerMTok / 1_000_000;
  const cachedInputUsd = tokens.cacheReadTokens * (pricing.cachedInputPerMTok ?? pricing.inputPerMTok) / 1_000_000;
  const cacheWriteUsd = tokens.cacheCreateTokens * (pricing.cacheWritePerMTok ?? pricing.inputPerMTok) / 1_000_000;
  const outputUsd = tokens.outputTokens * pricing.outputPerMTok / 1_000_000;
  return {
    estimatedUsd: inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd,
    inputUsd,
    cachedInputUsd,
    cacheWriteUsd,
    outputUsd,
    pricing,
    pricingStatus: "priced"
  };
}

function pricingForModel(model: string): ClaudeTapModelPricing | undefined {
  const normalized = normalizeModelName(model);
  const exact = PRICING.find((entry) => normalized === entry.model);
  if (exact) return exact;
  return PRICING.slice()
    .sort((a, b) => b.model.length - a.model.length)
    .find((entry) => normalized.startsWith(`${entry.model}-`));
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase().replace(/_/g, "-").replace(/^claude-/, "claude-");
}

function pricingMetadata() {
  return {
    generatedAt: new Date().toISOString(),
    note: "Estimated from public API token prices. Input, cache read, cache write, and output tokens are priced separately where model pricing is known.",
    sources: [
      { provider: "OpenAI", url: "https://developers.openai.com/api/docs/pricing", checkedAt: "2026-06-05" },
      { provider: "Anthropic", url: "https://platform.claude.com/docs/en/about-claude/pricing", checkedAt: "2026-06-05" }
    ]
  };
}

// Codex traces wrap the captured request/response in a `record` envelope
// (`{ __claude_tap_compact_record__, record }`); Claude traces store it at the
// top level. Unwrap the envelope only when it is actually present.
function recordFromPayload(payloadJson: string): Record<string, any> {
  const payload = parseObject(payloadJson);
  return payload.record != null ? parseObject(payload.record) : payload;
}

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function labelClient(client: string): string {
  if (client === "codex") return "Codex";
  if (client === "claude") return "Claude Code";
  return client || "Unknown";
}

function sum<T>(rows: T[], valueFor: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + valueFor(row), 0);
}
