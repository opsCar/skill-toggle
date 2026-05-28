import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Download,
  FileJson,
  FolderCog,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UsersRound,
  Wrench,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import "./index.css";

type ToolName = "claude" | "codex";
type Category = "skills" | "mcp" | "hooks" | "rules" | "agents" | "plugins" | "tools";

interface InventoryItem {
  id: string;
  tool: ToolName;
  category: Category;
  kind: "path" | "config-entry" | "session-derived";
  name: string;
  enabled: boolean;
  description: string;
  source: string;
  path?: string;
  backupPath?: string;
  detailAvailable: boolean;
  valid: boolean;
  invalidReason?: string;
  context: ContextStats;
}

interface ArchiveImportItem extends InventoryItem {
  archivePath: string;
  destinationPath: string;
  keyPath?: string[];
}

interface ImportInspection {
  token: string;
  sources: string[];
  items: ArchiveImportItem[];
}

interface ItemDetail extends InventoryItem {
  detail: string;
  detailType: "markdown" | "json" | "text" | "none";
}

interface UsageStats {
  total: number;
  claude: number;
  codex: number;
  skill: number;
  mcp: number;
  hook: number;
  tool: number;
  rule: number;
  agent: number;
  plugin: number;
  lastUsed?: string;
  evidence: string[];
}

interface ContextStats {
  estimatedTokens: number;
  characters: number;
  bytes: number;
  lines: number;
  metric: "approx_chars_per_token";
  charsPerToken: number;
}

interface ContextProbeContributor {
  id: string;
  tool: ToolName;
  category: Category;
  name: string;
  estimatedTokens: number;
  characters: number;
  source: string;
  path?: string;
}

interface ContextProbeBreakdown {
  category: Category;
  items: number;
  estimatedTokens: number;
  characters: number;
  bytes: number;
  lines: number;
}

interface ContextProbeTool {
  tool: ToolName;
  enabledItems: number;
  estimatedContextTokens: number;
  estimatedTotalTokens: number;
  promptTokens: number;
  characters: number;
  bytes: number;
  lines: number;
  breakdown: ContextProbeBreakdown[];
  topContributors: ContextProbeContributor[];
}

interface ContextProbe {
  generatedAt: string;
  prompt: string;
  metric: "approx_chars_per_token";
  charsPerToken: number;
  caveats: string[];
  tools: ContextProbeTool[];
}

interface StartupProbeComponent {
  kind: string;
  label: string;
  count?: number;
  estimatedTokens?: number;
  characters?: number;
}

interface StartupProbeTool {
  tool: ToolName;
  sessionPath?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  prompt?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalInputTokens?: number;
  modelContextWindow?: number;
  components: StartupProbeComponent[];
  warning?: string;
}

interface StartupProbe {
  generatedAt: string;
  metric: "session_history_usage";
  note: string;
  tools: StartupProbeTool[];
}

const categories: Array<{ key: Category | "all"; label: string; icon: React.ElementType }> = [
  { key: "all", label: "All", icon: Boxes },
  { key: "skills", label: "Skills", icon: BookOpen },
  { key: "tools", label: "Tools", icon: Wrench },
  { key: "mcp", label: "MCP", icon: FileJson },
  { key: "hooks", label: "Hooks", icon: Code2 },
  { key: "rules", label: "Rules", icon: ShieldCheck },
  { key: "agents", label: "Agents", icon: UsersRound },
  { key: "plugins", label: "Plugins", icon: Plug }
];

function App() {
  const [items, setItems] = React.useState<InventoryItem[]>([]);
  const [selected, setSelected] = React.useState<ItemDetail | null>(null);
  const [category, setCategory] = React.useState<Category | "all">("all");
  const [tool, setTool] = React.useState<ToolName | "all">("all");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [usageById, setUsageById] = React.useState<Record<string, UsageStats>>({});
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [startupProbe, setStartupProbe] = React.useState<StartupProbe | null>(null);
  const [contextProbeLoading, setContextProbeLoading] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState<number | null>(null);
  const [importProgress, setImportProgress] = React.useState<number | null>(null);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importInspection, setImportInspection] = React.useState<ImportInspection | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/inventory");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Inventory failed");
      setItems(data.items);
      void loadUsage();
      void loadStartupProbe();
      if (!selected && data.items.length > 0) void loadDetail(data.items[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load inventory");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  async function loadDetail(id: string) {
    const response = await fetch(`/api/items/${id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Detail failed");
    setSelected(data);
  }

  async function loadUsage() {
    setUsageLoading(true);
    try {
      const response = await fetch("/api/usage");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Usage scan failed");
      const next: Record<string, UsageStats> = {};
      for (const row of data.items ?? []) next[row.id] = row.usage;
      setUsageById(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Usage scan failed");
    } finally {
      setUsageLoading(false);
    }
  }

  async function loadStartupProbe() {
    setContextProbeLoading(true);
    try {
      const response = await fetch("/api/startup-probe");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Startup probe failed");
      setStartupProbe(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Startup probe failed");
    } finally {
      setContextProbeLoading(false);
    }
  }

  async function toggleItem(item: InventoryItem, enabled: boolean) {
    const response = await fetch(`/api/items/${item.id}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Toggle failed");
      return;
    }
    await loadItems();
    if (data.item) await loadDetail(data.item.id);
  }

  React.useEffect(() => {
    void loadItems();
  }, []);

  async function runExport(options: { filename: string; itemIds: string[]; saveHandle?: FileSystemFileHandle | null }) {
    setExportOpen(false);
    setBusy(true);
    setExportProgress(0);
    setError("");
    setStatus("Building archive — this can take a minute on a large env.");
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: options.filename, itemIds: options.itemIds })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error(data.error ?? "Export failed");
      }
      const totalHeader = response.headers.get("Content-Length");
      const total = totalHeader ? Number(totalHeader) : 0;
      let blob: Blob;
      if (response.body && total > 0) {
        setExportProgress(0);
        const reader = response.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          setExportProgress(Math.min(1, received / total));
        }
        blob = new Blob(chunks, { type: response.headers.get("Content-Type") ?? "application/gzip" });
      } else {
        blob = await response.blob();
      }
      setExportProgress(1);
      const headerFilename = response.headers.get("X-Skill-Toggle-Filename");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = headerFilename ?? match?.[1] ?? options.filename;
      let destinationLabel = "Downloads folder";
      if (options.saveHandle) {
        const writable = await options.saveHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        destinationLabel = options.saveHandle.name;
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
      const sources = response.headers.get("X-Skill-Toggle-Sources") ?? "";
      setStatus(`Exported ${filename} (${formatBytes(blob.size)}) → ${destinationLabel}${sources ? ` · sources: ${sources}` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
      setStatus("");
    } finally {
      setBusy(false);
      setExportProgress(null);
    }
  }

  async function replaceImportArchive(file: File) {
    setBusy(true);
    setImportProgress(0);
    setError("");
    setImportFile(null);
    setImportInspection(null);
    setStatus(`Replacing env from ${file.name} — backing up current env first...`);
    try {
      const data = await requestJsonWithProgress("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: file,
        onProgress: setImportProgress
      });
      setImportProgress(1);
      setStatus(`Replaced env from ${data.restoredSources?.join(", ") ?? "archive"}. Pre-import backup at ${data.preImportBackup}.`);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStatus("");
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  }

  async function inspectImportArchive(file: File) {
    setBusy(true);
    setImportProgress(0);
    setError("");
    setStatus(`Scanning ${file.name}...`);
    try {
      const data = await requestJsonWithProgress("/api/import/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: file,
        onProgress: setImportProgress
      });
      setImportProgress(1);
      setImportInspection(data);
      setStatus(`Scanned ${file.name}: ${data.items?.length ?? 0} importable items.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive scan failed");
      setStatus("");
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  }

  async function appendImportArchive(token: string, itemIds: string[]) {
    setBusy(true);
    setImportProgress(0);
    setError("");
    setStatus(`Appending ${itemIds.length} item${itemIds.length === 1 ? "" : "s"} from archive...`);
    try {
      const data = await requestJsonWithProgress("/api/import/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, itemIds }),
        onProgress: setImportProgress
      });
      setImportProgress(1);
      setImportFile(null);
      setImportInspection(null);
      setStatus(`Appended ${data.appendedItems?.length ?? itemIds.length} item${(data.appendedItems?.length ?? itemIds.length) === 1 ? "" : "s"} from archive.`);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Append import failed");
      setStatus("");
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  }

  function onImportPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      setImportFile(file);
      setImportInspection(null);
      setError("");
    }
  }

  const filtered = items.filter((item) => {
    const matchesCategory = category === "all" || item.category === category;
    const matchesTool = tool === "all" || item.tool === tool;
    const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
    return matchesCategory && matchesTool && haystack.includes(query.toLowerCase());
  });

  const itemsForTool = tool === "all" ? items : items.filter((item) => item.tool === tool);

  const categoryCounts = itemsForTool.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});

  const toolTotals = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.tool] = (acc[item.tool] ?? 0) + 1;
    return acc;
  }, {});

  const enabledCount = items.reduce((acc, item) => acc + Number(item.enabled), 0);
  const invalidSkillCount = itemsForTool.filter((item) => item.category === "skills" && !item.valid).length;
  const usageTotal = Object.values(usageById).reduce((acc, usage) => acc + usage.total, 0);
  const contextTotal = itemsForTool.reduce((acc, item) => acc + item.context.estimatedTokens, 0);
  const selectedUsage = selected ? usageById[selected.id] : undefined;
  const exportProgressText = formatProgressPercent(exportProgress);
  const importProgressText = formatProgressPercent(importProgress);

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-6 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="relative flex size-9 items-center justify-center rounded-lg bg-foreground text-background card-edge">
              <Sparkles className="size-[18px]" strokeWidth={1.6} />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-tightish text-foreground">Skill Toggle</h1>
                <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">v1</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Inventory across Claude Code &amp; Codex</p>
            </div>
          </div>

          <div className="hidden flex-1 items-center justify-center md:flex">
            <div className="flex items-center gap-0 rounded-full border border-border bg-card/70 py-1 pl-1 pr-1 card-edge">
              <StatPill label="Items" value={formatNumber(items.length)} />
              <StatDivider />
              <StatPill label="On" value={formatNumber(enabledCount)} accent />
              <StatDivider />
              <StatPill label="Claude" value={formatNumber(toolTotals.claude ?? 0)} />
              <StatDivider />
              <StatPill label="Codex" value={formatNumber(toolTotals.codex ?? 0)} />
              <StatDivider />
              <StatPill label="Uses" value={formatNumber(usageTotal)} />
              <StatDivider />
              <StatPill label="Tokens" value={formatNumber(contextTotal)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input ref={importInputRef} type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" className="hidden" onChange={onImportPicked} aria-label="Import archive file" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportOpen(true)}
              disabled={busy || loading || items.length === 0}
              className={`relative h-9 overflow-hidden px-3 ${exportProgress != null ? "disabled:opacity-100" : ""}`}
            >
              {exportProgress != null ? (
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-150 ease-out ${
                    exportProgress < 0 ? "w-full animate-pulse" : ""
                  }`}
                  style={exportProgress >= 0 ? { width: `${Math.round(exportProgress * 100)}%` } : undefined}
                />
              ) : null}
              <Download className="relative size-3.5" strokeWidth={1.75} />
              <span className="relative font-mono text-[12px]">{exportProgressText ?? "Export"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importInputRef.current?.click()}
              disabled={busy || loading}
              className={`h-9 px-3 ${importProgress != null ? "disabled:opacity-100" : ""}`}
            >
              <Upload className="size-3.5" strokeWidth={1.75} />
              <span className="font-mono text-[12px]">{importProgressText ?? "Import"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadItems()}
              disabled={loading || busy || contextProbeLoading}
              title="Refresh inventory"
              className="size-9 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
        {status || usageLoading || contextProbeLoading ? (
          <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-6 pb-2.5 text-[11px] text-muted-foreground">
            {usageLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Activity className="size-3 animate-pulse text-primary" strokeWidth={2} />
                Scanning Claude/Codex history…
              </span>
            ) : null}
            {contextProbeLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Activity className="size-3 animate-pulse text-primary" strokeWidth={2} />
                Probing baseline context…
              </span>
            ) : null}
            {status ? <span className="truncate">{status}</span> : null}
          </div>
        ) : null}
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[244px_minmax(340px,500px)_1fr] gap-6 p-6">
        <aside>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <SlidersHorizontal className="size-3" strokeWidth={2} />
              Filters
            </div>
            {invalidSkillCount > 0 ? (
              <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] text-destructive">{invalidSkillCount} invalid</span>
            ) : null}
          </div>

          <div className="mb-5 flex rounded-md border border-border bg-card p-0.5 card-edge">
            {(["all", "claude", "codex"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTool(key)}
                className={`relative flex-1 rounded-[6px] px-2 py-1.5 text-[12px] font-medium capitalize transition-all duration-150 press ${
                  tool === key
                    ? "bg-foreground text-background shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {key === "all" ? "All" : key === "claude" ? "Claude" : "Codex"}
              </button>
            ))}
          </div>

          <nav className="space-y-0.5">
            {categories.map(({ key, label, icon: Icon }) => {
              const active = category === key;
              const count = key === "all" ? itemsForTool.length : categoryCounts[key] ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  className={`group relative flex h-9 w-full items-center gap-2.5 rounded-md pl-3 pr-2.5 text-[13px] transition-colors press ${
                    active ? "bg-card text-foreground card-edge" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                  onClick={() => setCategory(key)}
                >
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full transition-all ${
                      active ? "bg-primary" : "bg-transparent group-hover:bg-border"
                    }`}
                  />
                  <Icon className={`size-3.5 ${active ? "text-foreground" : ""}`} strokeWidth={1.75} />
                  <span className="flex-1 text-left">{label}</span>
                  <span className={`font-mono text-[11px] tabular-nums ${active ? "text-foreground" : "text-muted-foreground/80"}`}>{count}</span>
                </button>
              );
            })}
          </nav>
          <StartupProbePanel probe={startupProbe} activeTool={tool} loading={contextProbeLoading} onRefresh={() => void loadStartupProbe()} />
        </aside>

        <section className="min-w-0">
          <label className="mb-3 flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 transition-colors focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            <input
              aria-label="Search inventory"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, path, or source…"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            ) : null}
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{filtered.length}</span>
          </label>
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div> : null}
          <ScrollArea className="h-[calc(100dvh-186px)]">
            <div className="overflow-hidden rounded-md border border-border bg-card card-edge">
              {loading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                      <div className="h-2 w-3/4 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Search className="size-4" strokeWidth={1.75} />
                  </div>
                  <div className="text-[13px] font-medium">No matching items</div>
                  <div className="mt-1 text-[12px] text-muted-foreground">Try a different search or clear your filters.</div>
                </div>
              ) : (
                <ul className="divide-y divide-border/70">
                  {filtered.map((item, index) => {
                    const isActive = selected?.id === item.id;
                    const usage = usageById[item.id];
                    const invalid = item.category === "skills" && !item.valid;
                    return (
                      <li
                        key={item.id}
                        className="row-mount"
                        style={{ ["--index" as any]: index < 24 ? index : 0 }}
                      >
                        <button
                          type="button"
                          className={`group relative flex w-full items-start px-3.5 py-3 text-left transition-colors press ${
                            isActive ? "bg-muted/60" : "hover:bg-muted/40"
                          }`}
                          onClick={() => void loadDetail(item.id)}
                        >
                          <span
                            aria-hidden
                            className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors ${
                              isActive ? "bg-primary" : item.enabled ? "bg-primary/40" : "bg-transparent"
                            }`}
                          />
                          <span
                            className={`mt-1 flex size-3 shrink-0 items-center justify-center ${item.enabled ? "text-primary" : "text-muted-foreground/40"}`}
                            title={item.enabled ? "Enabled" : "Disabled"}
                          >
                            {item.enabled ? (
                              <span className="block size-2 rounded-full bg-current shadow-[0_0_0_3px_currentColor]/[.12]" />
                            ) : (
                              <Circle className="size-2.5" strokeWidth={1.5} />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`truncate text-[13px] font-medium tracking-tightish ${isActive ? "text-foreground" : "text-foreground/90"}`}>
                                {item.name}
                              </span>
                              {invalid ? (
                                <span className="shrink-0 rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-destructive">
                                  invalid
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
                              {invalid ? item.invalidReason ?? "Skill is invalid" : item.description}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                              <span>{item.tool === "claude" ? "Claude" : "Codex"}</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span>{item.category}</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span>{formatNumber(usage?.total ?? 0)} uses</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span>{formatNumber(item.context.estimatedTokens)} tok</span>
                              {usage?.lastUsed ? (
                                <>
                                  <span className="text-muted-foreground/40">·</span>
                                  <span>{formatDate(usage.lastUsed)}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <ChevronRight
                            className={`mt-1 size-3.5 shrink-0 transition-all ${
                              isActive ? "translate-x-0 text-foreground" : "-translate-x-1 text-muted-foreground/0 group-hover:translate-x-0 group-hover:text-muted-foreground"
                            }`}
                            strokeWidth={1.75}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="min-w-0">
          {selected ? (
            <div className="flex h-[calc(100dvh-138px)] flex-col overflow-hidden rounded-md border border-border bg-card card-edge">
              <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-[18px] font-semibold tracking-tightish">{selected.name}</h2>
                    {selected.enabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-primary">
                        <Check className="size-2.5" strokeWidth={3} />
                        on
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">off</span>
                    )}
                    {selected.category === "skills" && !selected.valid ? (
                      <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive">invalid</span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">{selected.path ?? selected.backupPath}</div>
                  {selected.category === "skills" && !selected.valid ? (
                    <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[12px] text-destructive">
                      {selected.invalidReason ?? "Skill is invalid"}
                    </div>
                  ) : null}
                </div>
                {selected.kind === "session-derived" ? (
                  <div className="flex max-w-[280px] items-center gap-2 rounded-md border border-dashed border-border bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    <Wrench className="size-3.5 shrink-0" strokeWidth={1.75} />
                    <span>
                      {selected.source.startsWith("mcp:")
                        ? `Disable via the MCP entry "${selected.source.slice(4)}".`
                        : "Built-in tool · diagnostic only."}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {selected.enabled ? "On" : "Off"}
                    </span>
                    <Switch checked={selected.enabled} onCheckedChange={(checked) => void toggleItem(selected, checked)} />
                  </div>
                )}
              </header>

              <div className="flex-shrink-0 border-b border-border/60 px-5 py-3.5">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
                  <Field label="Tool" value={TOOL_LABELS[selected.tool]} />
                  <Field label="Category" value={CATEGORY_LABELS[selected.category]} />
                  <Field label="Kind" value={selected.kind === "path" ? "Path" : selected.kind === "session-derived" ? "Session-derived" : "Config entry"} />
                  <Field label="Source" value={selected.source} mono truncate />
                </div>
              </div>

              <div className="flex-shrink-0 border-b border-border/60 px-5 py-3.5">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Usage</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-5">
                  <Field label="Total" value={String(selectedUsage?.total ?? 0)} mono />
                  <Field label="Claude" value={String(selectedUsage?.claude ?? 0)} mono />
                  <Field label="Codex" value={String(selectedUsage?.codex ?? 0)} mono />
                  <Field label="Signal" value={usageSignal(selectedUsage)} />
                  <Field label="Last used" value={selectedUsage?.lastUsed ? formatDate(selectedUsage.lastUsed) : "—"} mono />
                </div>
              </div>

              <div className="flex-shrink-0 border-b border-border/60 px-5 py-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Context</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">~{selected.context.charsPerToken} chars/token</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
                  <Field label="Est. tokens" value={formatNumber(selected.context.estimatedTokens)} mono accent />
                  <Field label="Characters" value={formatNumber(selected.context.characters)} mono />
                  <Field label="Bytes" value={formatBytes(selected.context.bytes)} mono />
                  <Field label="Lines" value={formatNumber(selected.context.lines)} mono />
                </div>
              </div>

              {selectedUsage?.evidence?.length ? (
                <div className="flex-shrink-0 border-b border-border/60 px-5 py-3.5">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Evidence</div>
                  <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                    {selectedUsage.evidence.map((entry) => (
                      <li key={entry} className="truncate">
                        {entry}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ScrollArea className="min-h-0 flex-1 bg-card">
                <pre className="whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-[1.65] text-foreground/90">
                  {selected.detail}
                </pre>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex h-[calc(100dvh-138px)] flex-col items-center justify-center rounded-md border border-dashed border-border bg-card/40">
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Boxes className="size-5" strokeWidth={1.5} />
              </div>
              <div className="text-[14px] font-medium">Select an item</div>
              <div className="mt-1 max-w-[28ch] text-center text-[12px] text-muted-foreground">
                Pick a skill, agent, MCP entry, hook, rule, or plugin from the list to inspect &amp; toggle it.
              </div>
            </div>
          )}
        </section>
      </div>
      {exportOpen ? (
        <ExportDialog
          items={items}
          onCancel={() => setExportOpen(false)}
          onExport={(selection) => void runExport(selection)}
        />
      ) : null}
      {importFile ? (
        <ImportDialog
          file={importFile}
          inspection={importInspection}
          busy={busy}
          progressText={importProgressText}
          onCancel={() => {
            setImportFile(null);
            setImportInspection(null);
          }}
          onReplace={() => void replaceImportArchive(importFile)}
          onInspect={() => void inspectImportArchive(importFile)}
          onAppend={(itemIds) => {
            if (importInspection) void appendImportArchive(importInspection.token, itemIds);
          }}
        />
      ) : null}
    </main>
  );
}

const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex"
};

const CATEGORY_LABELS: Record<Category, string> = {
  skills: "Skills",
  tools: "Tools",
  mcp: "MCP",
  hooks: "Hooks",
  rules: "Rules",
  agents: "Agents",
  plugins: "Plugins"
};

const CATEGORY_ORDER: Category[] = ["skills", "tools", "agents", "plugins", "mcp", "hooks", "rules"];

interface ExportSelection {
  filename: string;
  itemIds: string[];
  saveHandle?: FileSystemFileHandle | null;
}

function StartupProbePanel({
  probe,
  activeTool,
  loading,
  onRefresh
}: {
  probe: StartupProbe | null;
  activeTool: ToolName | "all";
  loading: boolean;
  onRefresh: () => void;
}) {
  const visibleTools = React.useMemo(() => {
    const tools = probe?.tools ?? [];
    return activeTool === "all" ? tools : tools.filter((row) => row.tool === activeTool);
  }, [activeTool, probe]);

  return (
    <div className="mt-3 rounded-md border border-border bg-card p-3 card-edge">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Startup probe</div>
          <div className="mt-0.5 truncate text-[12px] text-muted-foreground">from session history</div>
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onRefresh} disabled={loading} title="Refresh startup probe">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
        </Button>
      </div>

      {!probe ? (
        <div className="mt-3 text-[12px] text-muted-foreground">{loading ? "Reading sessions…" : "No probe data yet."}</div>
      ) : (
        <div className="mt-3 space-y-3">
          {visibleTools.map((row) => (
            <div key={row.tool} className="rounded-md border border-border/80 bg-background/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-medium">{TOOL_LABELS[row.tool]}</div>
                  <div className="mt-0.5 max-w-[120px] truncate text-[10px] text-muted-foreground" title={row.prompt}>
                    first: {shortPrompt(row.prompt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[16px] font-semibold tabular-nums">{formatNumber(row.totalInputTokens ?? row.inputTokens ?? 0)}</div>
                  <div className="text-[10px] text-muted-foreground">input tokens</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <MiniMetric label="direct" value={formatNumber(row.inputTokens ?? 0)} />
                <MiniMetric label="cached" value={formatNumber((row.cachedInputTokens ?? 0) + (row.cacheCreationInputTokens ?? 0))} />
              </div>
              {row.warning ? <div className="mt-2 text-[11px] text-muted-foreground">{row.warning}</div> : null}
              {row.components.length ? (
                <div className="mt-3 border-t border-border/70 pt-2">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Loaded at startup</div>
                  <div className="space-y-1">
                    {row.components.slice(0, 6).map((item, index) => (
                      <div key={`${item.kind}-${index}`} className="flex items-center gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
                        {item.count != null ? <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{item.count}</span> : null}
                        {item.estimatedTokens != null ? <span className="font-mono tabular-nums text-muted-foreground">~{formatNumber(item.estimatedTokens)}</span> : null}
                      </div>
                    ))}
                    {row.components.length > 6 ? (
                      <div className="text-[10px] text-muted-foreground">+{row.components.length - 6} more startup entries</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="mt-2 truncate text-[10px] text-muted-foreground" title={row.sessionPath}>
                {row.version ? `v${row.version}` : "session"} {row.modelContextWindow ? ` · window ${formatNumber(row.modelContextWindow)}` : ""}
              </div>
            </div>
          ))}
          <div className="text-[10px] leading-4 text-muted-foreground">
            This reads the first recorded request in the latest session for this workspace. For a true blank baseline, start a fresh agent session, send only hello, then refresh.
          </div>
        </div>
      )}
    </div>
  );
}

function shortPrompt(value?: string) {
  if (!value) return "unknown";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}
function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/70 bg-muted/30 px-2 py-1">
      <div className="font-mono text-[11px] tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ExportDialog({
  items,
  onCancel,
  onExport
}: {
  items: InventoryItem[];
  onCancel: () => void;
  onExport: (selection: ExportSelection) => void;
}) {
  const defaultFilename = React.useMemo(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `skill-toggle-export-${stamp}.tar.gz`;
  }, []);
  const [filename, setFilename] = React.useState(defaultFilename);
  const [saveHandle, setSaveHandle] = React.useState<FileSystemFileHandle | null>(null);
  const exportableItems = React.useMemo(() => items.filter((item) => item.kind !== "session-derived"), [items]);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(exportableItems.map((item) => item.id)));
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(["tool:claude", "tool:codex"]));

  const supportsFilePicker = typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

  const groups = React.useMemo(() => {
    const map = new Map<ToolName, Map<Category, InventoryItem[]>>();
    for (const item of exportableItems) {
      let toolMap = map.get(item.tool);
      if (!toolMap) {
        toolMap = new Map();
        map.set(item.tool, toolMap);
      }
      const list = toolMap.get(item.category) ?? [];
      list.push(item);
      toolMap.set(item.category, list);
    }
    const tools = Array.from(map.keys()).sort();
    return tools.map((tool) => {
      const toolMap = map.get(tool)!;
      const cats = CATEGORY_ORDER.flatMap((cat) =>
        toolMap.has(cat)
          ? [{
              category: cat,
              items: (toolMap.get(cat) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
            }]
          : []
      );
      return { tool, categories: cats };
    });
  }, [items]);

  function setMany(ids: string[], wanted: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (wanted) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toolState(toolItems: InventoryItem[]): "all" | "some" | "none" {
    let on = 0;
    for (const item of toolItems) if (selected.has(item.id)) on += 1;
    if (on === 0) return "none";
    if (on === toolItems.length) return "all";
    return "some";
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function chooseLocation() {
    if (!supportsFilePicker) return;
    try {
      const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Gzipped tar archive",
            accept: { "application/gzip": [".tar.gz", ".tgz"] }
          }
        ]
      });
      setSaveHandle(handle);
      if (handle.name) setFilename(handle.name);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      // ignore other picker errors; user can still use browser download
    }
  }

  function handleExport() {
    onExport({ filename: filename.trim() || defaultFilename, itemIds: Array.from(selected), saveHandle });
  }

  const totalSelected = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl card-edge">
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Download className="size-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-[15px] font-semibold tracking-tightish">Export setup</h2>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Pick a filename, optional save location, and the scope to include.{" "}
              <span className="font-mono tabular-nums text-foreground">{totalSelected}</span> of{" "}
              <span className="font-mono tabular-nums">{exportableItems.length}</span> items selected.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-3 border-b border-border/70 px-5 py-4 sm:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Filename</span>
            <input
              aria-label="Export filename"
              className="h-9 rounded-md border border-border bg-background px-3 font-mono text-[12.5px] outline-none transition-colors focus:border-foreground/30 focus:ring-2 focus:ring-ring/20"
              value={filename}
              onChange={(event) => {
                setFilename(event.target.value);
                if (saveHandle) setSaveHandle(null);
              }}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Save location</span>
            {supportsFilePicker ? (
              <Button type="button" variant="outline" onClick={() => void chooseLocation()}>
                <FolderCog className="size-3.5" strokeWidth={1.75} />
                {saveHandle ? "Change…" : "Choose…"}
              </Button>
            ) : (
              <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-[12px] text-muted-foreground">
                Browser Downloads folder
              </div>
            )}
            {saveHandle ? <span className="truncate font-mono text-[11px] text-muted-foreground">→ {saveHandle.name}</span> : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-border/70 px-5 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Scope · pre-selected</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] transition-colors press hover:bg-muted/60"
              onClick={() => setSelected(new Set(exportableItems.map((item) => item.id)))}
            >
              Select all
            </button>
            <button type="button" className="rounded-md border border-border bg-card px-2 py-1 text-[11px] transition-colors press hover:bg-muted/60" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>

        <ScrollArea className="h-[420px] bg-background/40">
          <div className="px-5 py-3">
            {groups.map(({ tool, categories: catGroups }) => {
              const toolItems = catGroups.flatMap((group) => group.items);
              const toolKey = `tool:${tool}`;
              const toolStatus = toolState(toolItems);
              const isExpanded = expanded.has(toolKey);
              return (
                <div key={tool} className="mb-3 overflow-hidden rounded-md border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(toolKey)}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? <ChevronDown className="size-3.5" strokeWidth={1.75} /> : <ChevronRight className="size-3.5" strokeWidth={1.75} />}
                    </button>
                    <TriCheckbox
                      state={toolStatus}
                      onChange={(checked) => setMany(toolItems.map((item) => item.id), checked)}
                    />
                    <div className="flex-1 text-[13px] font-medium">{TOOL_LABELS[tool]}</div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {toolItems.filter((item) => selected.has(item.id)).length}/{toolItems.length}
                    </span>
                  </div>
                  {isExpanded ? (
                    <div className="space-y-1.5 bg-muted/20 px-2.5 py-2">
                      {catGroups.map(({ category, items: catItems }) => {
                        const catKey = `cat:${tool}:${category}`;
                        const catExpanded = expanded.has(catKey);
                        let onCount = 0;
                        for (const item of catItems) if (selected.has(item.id)) onCount += 1;
                        const catStatus: "all" | "some" | "none" = onCount === 0 ? "none" : onCount === catItems.length ? "all" : "some";
                        return (
                          <div key={category} className="overflow-hidden rounded-md border border-border/70 bg-card">
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(catKey)}
                                className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                aria-label={catExpanded ? "Collapse" : "Expand"}
                              >
                                {catExpanded ? <ChevronDown className="size-3" strokeWidth={1.75} /> : <ChevronRight className="size-3" strokeWidth={1.75} />}
                              </button>
                              <TriCheckbox state={catStatus} onChange={(checked) => setMany(catItems.map((item) => item.id), checked)} />
                              <div className="flex-1 text-[12.5px]">{CATEGORY_LABELS[category]}</div>
                              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{onCount}/{catItems.length}</span>
                            </div>
                            {catExpanded ? (
                              <div className="divide-y divide-border/60 border-t border-border/60 bg-background/40">
                                {catItems.map((item) => {
                                  const isOn = selected.has(item.id);
                                  return (
                                    <label key={item.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] transition-colors hover:bg-muted/60">
                                      <TriCheckbox
                                        state={isOn ? "all" : "none"}
                                        onChange={(checked) => setMany([item.id], checked)}
                                      />
                                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                      <span
                                        className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                                          item.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                        }`}
                                      >
                                        {item.enabled ? "on" : "off"}
                                      </span>
                                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                        {item.kind === "path" ? "path" : item.kind === "session-derived" ? "session" : "config"}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {groups.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-card/40 p-8 text-center text-[12.5px] text-muted-foreground">
                No items detected in your environment.
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            {totalSelected} of {exportableItems.length} ready
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={handleExport} disabled={totalSelected === 0}>
              <Download className="size-3.5" strokeWidth={1.75} />
              Export {totalSelected} item{totalSelected === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({
  file,
  inspection,
  busy,
  progressText,
  onCancel,
  onReplace,
  onInspect,
  onAppend
}: {
  file: File;
  inspection: ImportInspection | null;
  busy: boolean;
  progressText: string | null;
  onCancel: () => void;
  onReplace: () => void;
  onInspect: () => void;
  onAppend: (itemIds: string[]) => void;
}) {
  const [mode, setMode] = React.useState<"replace" | "append">("replace");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(["tool:claude", "tool:codex"]));

  React.useEffect(() => {
    if (inspection) setSelected(new Set(inspection.items.map((item) => item.id)));
  }, [inspection]);

  const groups = React.useMemo(() => groupItems(inspection?.items ?? []), [inspection]);
  const totalSelected = selected.size;

  function setMany(ids: string[], wanted: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (wanted) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl card-edge">
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-[15px] font-semibold tracking-tightish">Import archive</h2>
            </div>
            <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-3 border-b border-border/70 px-5 py-4 sm:grid-cols-2">
          <button
            type="button"
            className={`relative overflow-hidden rounded-md border p-3 text-left transition-all press ${
              mode === "replace" ? "border-foreground/30 bg-card card-edge" : "border-border hover:bg-muted/40"
            }`}
            onClick={() => setMode("replace")}
          >
            {mode === "replace" ? <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" /> : null}
            <div className="text-[13px] font-medium">Replace current</div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              Completely replace local Claude/Codex env with this archive. A pre-import backup is created first.
            </div>
          </button>
          <button
            type="button"
            className={`relative overflow-hidden rounded-md border p-3 text-left transition-all press ${
              mode === "append" ? "border-foreground/30 bg-card card-edge" : "border-border hover:bg-muted/40"
            }`}
            onClick={() => setMode("append")}
          >
            {mode === "append" ? <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" /> : null}
            <div className="text-[13px] font-medium">Append selected</div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              Scan the archive and add only selected skills, agents, plugins, MCP entries, hooks, or rules to the current env.
            </div>
          </button>
        </div>

        {mode === "replace" ? (
          <div className="p-5 text-[12.5px] leading-relaxed text-muted-foreground">
            This mode replaces the archive's top-level env folders, including matching disabled-item backups, after writing a backup tar under{" "}
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">~/.skill-toggle-backups/</span>.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-2.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {inspection ? `${totalSelected} of ${inspection.items.length} selected` : "Scan archive to begin"}
              </span>
              {inspection ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-2 py-1 text-[11px] transition-colors press hover:bg-muted/60"
                    onClick={() => setSelected(new Set(inspection.items.map((item) => item.id)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-2 py-1 text-[11px] transition-colors press hover:bg-muted/60"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
            <ScrollArea className="h-[420px] bg-background/40">
              <div className="px-5 py-3">
                {!inspection ? (
                  <div className="rounded-md border border-dashed border-border bg-card/40 p-8 text-center text-[12.5px] text-muted-foreground">
                    Archive contents have not been scanned yet.
                  </div>
                ) : groups.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-card/40 p-8 text-center text-[12.5px] text-muted-foreground">
                    No importable items found in this archive.
                  </div>
                ) : (
                  groups.map(({ tool, categories: catGroups }) => {
                    const toolItems = catGroups.flatMap((group) => group.items);
                    const toolKey = `tool:${tool}`;
                    const toolStatus = selectedState(toolItems, selected);
                    const isExpanded = expanded.has(toolKey);
                    return (
                      <div key={tool} className="mb-3 overflow-hidden rounded-md border border-border bg-card">
                        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(toolKey)}
                            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? <ChevronDown className="size-3.5" strokeWidth={1.75} /> : <ChevronRight className="size-3.5" strokeWidth={1.75} />}
                          </button>
                          <TriCheckbox state={toolStatus} onChange={(checked) => setMany(toolItems.map((item) => item.id), checked)} />
                          <div className="flex-1 text-[13px] font-medium">{TOOL_LABELS[tool]}</div>
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {toolItems.filter((item) => selected.has(item.id)).length}/{toolItems.length}
                          </span>
                        </div>
                        {isExpanded ? (
                          <div className="space-y-1.5 bg-muted/20 px-2.5 py-2">
                            {catGroups.map(({ category, items: catItems }) => {
                              const catKey = `cat:${tool}:${category}`;
                              const catExpanded = expanded.has(catKey);
                              const catStatus = selectedState(catItems, selected);
                              return (
                                <div key={category} className="overflow-hidden rounded-md border border-border/70 bg-card">
                                  <div className="flex items-center gap-2 px-3 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(catKey)}
                                      className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                      aria-label={catExpanded ? "Collapse" : "Expand"}
                                    >
                                      {catExpanded ? <ChevronDown className="size-3" strokeWidth={1.75} /> : <ChevronRight className="size-3" strokeWidth={1.75} />}
                                    </button>
                                    <TriCheckbox state={catStatus} onChange={(checked) => setMany(catItems.map((item) => item.id), checked)} />
                                    <div className="flex-1 text-[12.5px]">{CATEGORY_LABELS[category]}</div>
                                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                                      {catItems.filter((item) => selected.has(item.id)).length}/{catItems.length}
                                    </span>
                                  </div>
                                  {catExpanded ? (
                                    <div className="divide-y divide-border/60 border-t border-border/60 bg-background/40">
                                      {catItems.map((item) => {
                                        const isOn = selected.has(item.id);
                                        return (
                                          <label key={item.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] transition-colors hover:bg-muted/60">
                                            <TriCheckbox state={isOn ? "all" : "none"} onChange={(checked) => setMany([item.id], checked)} />
                                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                            <span className="truncate font-mono text-[11px] text-muted-foreground">{item.archivePath}</span>
                                            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                              {item.kind === "path" ? "path" : item.kind === "session-derived" ? "session" : "config"}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            {mode === "replace" ? "Mode · replace" : inspection ? `${totalSelected} ready to append` : "Awaiting scan"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            {mode === "replace" ? (
              <Button variant="primary" onClick={onReplace} disabled={busy}>
                <Upload className="size-3.5" strokeWidth={1.75} />
                {progressText ?? "Replace current"}
              </Button>
            ) : !inspection ? (
              <Button variant="primary" onClick={onInspect} disabled={busy}>
                <Search className="size-3.5" strokeWidth={1.75} />
                {progressText ?? "Scan archive"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => onAppend(Array.from(selected))} disabled={busy || totalSelected === 0}>
                <Upload className="size-3.5" strokeWidth={1.75} />
                {progressText ?? `Append ${totalSelected} item${totalSelected === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function groupItems<T extends InventoryItem>(items: T[]) {
  const map = new Map<ToolName, Map<Category, T[]>>();
  for (const item of items) {
    let toolMap = map.get(item.tool);
    if (!toolMap) {
      toolMap = new Map();
      map.set(item.tool, toolMap);
    }
    const list = toolMap.get(item.category) ?? [];
    list.push(item);
    toolMap.set(item.category, list);
  }
  return Array.from(map.keys()).sort().map((tool) => {
    const toolMap = map.get(tool)!;
    const cats = CATEGORY_ORDER.flatMap((cat) =>
      toolMap.has(cat)
        ? [{
            category: cat,
            items: (toolMap.get(cat) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
          }]
        : []
    );
    return { tool, categories: cats };
  });
}

function selectedState(items: InventoryItem[], selected: Set<string>): "all" | "some" | "none" {
  let on = 0;
  for (const item of items) if (selected.has(item.id)) on += 1;
  if (on === 0) return "none";
  if (on === items.length) return "all";
  return "some";
}

function TriCheckbox({ state, onChange }: { state: "all" | "some" | "none"; onChange: (checked: boolean) => void }) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Toggle selection"
      className="size-[14px] cursor-pointer rounded accent-foreground transition-transform active:scale-90"
      checked={state === "all"}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function requestJsonWithProgress<T = any>(
  url: string,
  {
    method,
    headers,
    body,
    onProgress
  }: {
    method: string;
    headers: Record<string, string>;
    body: XMLHttpRequestBodyInit;
    onProgress: (progress: number) => void;
  }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      onProgress(Math.min(0.95, event.loaded / event.total));
    };
    xhr.onload = () => {
      const data = parseJsonResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      reject(new Error((data as { error?: string }).error ?? "Request failed"));
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.send(body);
  });
}

function parseJsonResponse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function formatProgressPercent(progress: number | null): string | null {
  if (progress == null) return null;
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const numberFormatter = new Intl.NumberFormat();
function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function usageSignal(usage?: UsageStats): string {
  if (!usage || usage.total === 0) return "none";
  const rows: Array<[string, number]> = [
    ["skill", usage.skill],
    ["mcp", usage.mcp],
    ["hook", usage.hook],
    ["tool", usage.tool],
    ["rule", usage.rule],
    ["agent", usage.agent],
    ["plugin", usage.plugin]
  ];
  return rows.reduce((best, row) => (row[1] > best[1] ? row : best))[0];
}

function Field({
  label,
  value,
  mono,
  accent,
  truncate
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">{label}</div>
      <div
        className={`mt-0.5 text-[13px] tabular-nums ${mono ? "font-mono" : ""} ${accent ? "text-primary font-medium" : "text-foreground"} ${
          truncate ? "truncate" : ""
        }`}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-[12px] font-medium tabular-nums ${
          accent ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StatDivider() {
  return <span aria-hidden className="h-3 w-px bg-border" />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
