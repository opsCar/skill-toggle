import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDetail, listInventory, toggleItem } from "./discovery";

const app = express();
const port = Number(process.env.PORT ?? process.env.SKILL_TOGGLE_API_PORT ?? 4127);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

app.use(express.json({ limit: "1mb" }));

app.get("/api/inventory", async (_req, res, next) => {
  try {
    res.json({ items: await listInventory() });
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
