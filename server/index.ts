import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendImportArchive, applyImportArchive, inspectImportArchive, writeExportArchive } from "./archive";
import { getDetail, listInventory, toggleItem } from "./discovery";
import { getContextProbe, getStartupProbe, getUsageSummary } from "./usage";

const app = express();
const port = Number(process.env.PORT ?? process.env.SKILL_TOGGLE_API_PORT ?? 4127);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const importSessions = new Map<string, { path: string; createdAt: number }>();

app.use(express.json({ limit: "1mb" }));

app.get("/api/inventory", async (_req, res, next) => {
  try {
    res.json({ items: await listInventory() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/usage", async (_req, res, next) => {
  try {
    const items = await listInventory();
    res.json(await getUsageSummary(items));
  } catch (error) {
    next(error);
  }
});

app.get("/api/context-probe", async (req, res, next) => {
  try {
    const prompt = typeof req.query.prompt === "string" ? req.query.prompt : "hello";
    const items = await listInventory();
    res.json(getContextProbe(items, prompt));
  } catch (error) {
    next(error);
  }
});

app.get("/api/startup-probe", async (_req, res, next) => {
  try {
    res.json(await getStartupProbe());
  } catch (error) {
    next(error);
  }
});

app.get("/api/items/:id", async (req, res, next) => {
  try {
    const detail = await getDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/toggle", async (req, res, next) => {
  try {
    const item = await toggleItem(req.params.id, Boolean(req.body?.enabled));
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

async function handleExport(req: express.Request, res: express.Response, next: express.NextFunction) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const body = (req.body ?? {}) as { filename?: unknown; itemIds?: unknown };
  const rawFilename = typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : `skill-toggle-export-${stamp}.tar.gz`;
  const safeFilename = sanitizeFilename(rawFilename, stamp);
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((id): id is string => typeof id === "string") : undefined;
  const tmpPath = path.join(os.tmpdir(), `skill-toggle-export-tmp-${stamp}-${process.pid}.tar.gz`);
  try {
    const summary = await writeExportArchive(tmpPath, itemIds);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Length", String(summary.bytes));
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.setHeader("X-Skill-Toggle-Sources", summary.sources.join(","));
    res.setHeader("X-Skill-Toggle-Filename", safeFilename);
    const stream = createReadStream(tmpPath);
    stream.on("close", () => {
      void fs.rm(tmpPath, { force: true });
    });
    stream.on("error", (err) => {
      void fs.rm(tmpPath, { force: true });
      next(err);
    });
    stream.pipe(res);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    next(error);
  }
}

function sanitizeFilename(input: string, stamp: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  const base = cleaned.length > 0 ? cleaned : `skill-toggle-export-${stamp}`;
  return /\.(tar\.gz|tgz)$/i.test(base) ? base : `${base}.tar.gz`;
}


app.get("/api/export", handleExport);
app.post("/api/export", handleExport);

app.post("/api/import", express.raw({ type: ["application/gzip", "application/x-gzip", "application/octet-stream"], limit: "5gb" }), async (req, res, next) => {
  const body = req.body as Buffer | undefined;
  if (!body || body.length === 0) {
    res.status(400).json({ error: "Empty upload — send the tar.gz as the raw request body" });
    return;
  }
  const tmpPath = path.join(os.tmpdir(), `skill-toggle-import-${Date.now()}.tar.gz`);
  try {
    await fs.writeFile(tmpPath, body);
    const summary = await applyImportArchive(tmpPath);
    res.json(summary);
  } catch (error) {
    next(error);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }
});

app.post("/api/import/inspect", express.raw({ type: ["application/gzip", "application/x-gzip", "application/octet-stream"], limit: "5gb" }), async (req, res, next) => {
  const body = req.body as Buffer | undefined;
  if (!body || body.length === 0) {
    res.status(400).json({ error: "Empty upload — send the tar.gz as the raw request body" });
    return;
  }
  const token = cryptoRandomToken();
  const tmpPath = path.join(os.tmpdir(), `skill-toggle-import-session-${token}.tar.gz`);
  try {
    await fs.writeFile(tmpPath, body);
    const inspection = await inspectImportArchive(tmpPath);
    importSessions.set(token, { path: tmpPath, createdAt: Date.now() });
    cleanupImportSessions();
    res.json({ token, ...inspection });
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    next(error);
  }
});

app.post("/api/import/append", async (req, res, next) => {
  const body = (req.body ?? {}) as { token?: unknown; itemIds?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const session = importSessions.get(token);
  if (!session) {
    res.status(400).json({ error: "Import session expired. Pick the archive again." });
    return;
  }
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((id): id is string => typeof id === "string") : [];
  try {
    const summary = await appendImportArchive(session.path, itemIds);
    importSessions.delete(token);
    await fs.rm(session.path, { force: true }).catch(() => undefined);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

function cryptoRandomToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanupImportSessions() {
  const expiresAt = Date.now() - 30 * 60 * 1000;
  for (const [token, session] of importSessions.entries()) {
    if (session.createdAt < expiresAt) {
      importSessions.delete(token);
      void fs.rm(session.path, { force: true });
    }
  }
}

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) {
    next();
    return;
  }
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error";
  res.status(Number.isFinite(statusCode) ? statusCode : 500).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Skill Toggle API listening on http://127.0.0.1:${port}`);
});
