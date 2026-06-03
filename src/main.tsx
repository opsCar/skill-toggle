import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  BookOpen,
  Boxes,
  Check,
  ChevronRight,
  Circle,
  Code2,
  Download,
  FileJson,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Upload,
  UsersRound,
  Workflow,
  Wrench,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ExportDialog } from "@/components/ExportDialog";
import { ImportDialog } from "@/components/ImportDialog";
import { DiagnosticsDialog } from "@/components/DiagnosticsDialog";
import { StartupProbePanel } from "@/components/StartupProbePanel";
import { Field, StatDivider, StatPill, TriCheckbox } from "@/components/primitives";
import {
  formatBytes,
  formatDate,
  formatNumber,
  formatProgressPercent,
  requestJsonWithProgress,
  selectedState,
  usageSignal
} from "@/lib/format";
import {
  CATEGORY_LABELS,
  TOOL_LABELS,
  type Category,
  type ExportSelection,
  type ImportInspection,
  type InventoryItem,
  type ItemDetail,
  type StartupProbe,
  type ToolName,
  type UsageStats
} from "@/types";
import "./index.css";

const categories: Array<{ key: Category | "all"; label: string; icon: React.ElementType }> = [
  { key: "all", label: "All", icon: Boxes },
  { key: "skills", label: "Skills", icon: BookOpen },
  { key: "tools", label: "Tools", icon: Wrench },
  { key: "mcp", label: "MCP", icon: FileJson },
  { key: "hooks", label: "Hooks", icon: Code2 },
  { key: "rules", label: "Rules", icon: ShieldCheck },
  { key: "agents", label: "Agents", icon: UsersRound },
  { key: "plugins", label: "Plugins", icon: Plug },
  { key: "workflows", label: "Workflows", icon: Workflow }
];

const INVENTORY_ROW_HEIGHT = 86;
const INVENTORY_OVERSCAN = 8;

function App() {
  const [items, setItems] = React.useState<InventoryItem[]>([]);
  const [selected, setSelected] = React.useState<ItemDetail | null>(null);
  const [category, setCategory] = React.useState<Category | "all">("all");
  const [tool, setTool] = React.useState<ToolName | "all">("all");
  const [origin, setOrigin] = React.useState<"all" | "builtin" | "custom">("all");
  const [query, setQuery] = React.useState("");
  const [selectedListIds, setSelectedListIds] = React.useState<Set<string>>(new Set());
  const [usageOperator, setUsageOperator] = React.useState<"lt" | "eq" | "gt">("eq");
  const [usageValue, setUsageValue] = React.useState("");
  const [usageSortOrder, setUsageSortOrder] = React.useState<"desc" | "asc">("desc");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [usageById, setUsageById] = React.useState<Record<string, UsageStats>>({});
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [startupProbe, setStartupProbe] = React.useState<StartupProbe | null>(null);
  const [contextProbeLoading, setContextProbeLoading] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState<number | null>(null);
  const [importProgress, setImportProgress] = React.useState<number | null>(null);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importInspection, setImportInspection] = React.useState<ImportInspection | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const inventoryViewportRef = React.useRef<HTMLDivElement>(null);
  const [inventoryScrollTop, setInventoryScrollTop] = React.useState(0);
  const [inventoryViewportHeight, setInventoryViewportHeight] = React.useState(0);

  // Track the current selection in a ref so loadItems can decide whether to
  // auto-select the first row without depending on `selected` (which would
  // recreate the callback and re-run the mount effect on every selection).
  const selectedRef = React.useRef<ItemDetail | null>(null);
  selectedRef.current = selected;
  const detailAbortRef = React.useRef<AbortController | null>(null);

  const loadDetail = React.useCallback(async (id: string) => {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    try {
      const response = await fetch(`/api/items/${id}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Detail failed");
      setSelected(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }, []);

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/inventory");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Inventory failed");
      setItems(data.items);
      void loadUsage();
      // Startup probe hidden for now — not ready. Re-enable with the panel below.
      // void loadStartupProbe();
      if (!selectedRef.current && data.items.length > 0) void loadDetail(data.items[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load inventory");
    } finally {
      setLoading(false);
    }
  }, [loadDetail]);

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

  async function disableManyItems(targets: InventoryItem[]) {
    const list = targets.filter((item) => item.enabled && item.kind !== "session-derived");
    if (list.length === 0) return;
    setBusy(true);
    setError("");
    setStatus(`Disabling ${list.length} item${list.length === 1 ? "" : "s"} from diagnostics…`);
    try {
      for (const item of list) {
        const response = await fetch(`/api/items/${item.id}/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Failed to disable ${item.name}`);
      }
      setStatus(`Disabled ${list.length} item${list.length === 1 ? "" : "s"} from diagnostics.`);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk disable failed");
      setStatus("");
      await loadItems();
    } finally {
      setBusy(false);
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

  React.useEffect(() => {
    const viewport = inventoryViewportRef.current;
    if (!viewport) return;
    const updateHeight = () => setInventoryViewportHeight(viewport.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
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

  const usageNumber = usageValue.trim() === "" ? null : Number(usageValue);
  const hasUsageFilter = usageNumber !== null && Number.isFinite(usageNumber);
  const filtered = React.useMemo(() => {
    const filteredItems = items.filter((item) => {
      const matchesCategory = category === "all" || item.category === category;
      const matchesTool = tool === "all" || item.tool === tool;
      const matchesOrigin = origin === "all" || (origin === "builtin" ? item.builtin : !item.builtin);
      const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
      const usageTotal = usageById[item.id]?.total ?? 0;
      const matchesUsage =
        !hasUsageFilter ||
        (usageOperator === "lt" && usageTotal < usageNumber!) ||
        (usageOperator === "eq" && usageTotal === usageNumber!) ||
        (usageOperator === "gt" && usageTotal > usageNumber!);
      return matchesCategory && matchesTool && matchesOrigin && matchesUsage && haystack.includes(query.toLowerCase());
    });

    return filteredItems.slice().sort((a, b) => {
      const usageDelta =
        usageSortOrder === "desc"
          ? (usageById[b.id]?.total ?? 0) - (usageById[a.id]?.total ?? 0)
          : (usageById[a.id]?.total ?? 0) - (usageById[b.id]?.total ?? 0);
      if (usageDelta !== 0) return usageDelta;
      return a.name.localeCompare(b.name);
    });
  }, [category, hasUsageFilter, items, origin, query, tool, usageById, usageNumber, usageOperator, usageSortOrder]);
  React.useEffect(() => {
    const viewport = inventoryViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    setInventoryScrollTop(0);
  }, [category, tool, origin, query, usageOperator, usageValue, usageSortOrder]);

  const visibleStart = Math.max(0, Math.floor(inventoryScrollTop / INVENTORY_ROW_HEIGHT) - INVENTORY_OVERSCAN);
  const visibleEnd = Math.min(
    filtered.length,
    Math.ceil((inventoryScrollTop + inventoryViewportHeight) / INVENTORY_ROW_HEIGHT) + INVENTORY_OVERSCAN
  );
  const visibleItems = filtered.slice(visibleStart, visibleEnd);
  const virtualPaddingTop = visibleStart * INVENTORY_ROW_HEIGHT;
  const virtualPaddingBottom = Math.max(0, (filtered.length - visibleEnd) * INVENTORY_ROW_HEIGHT);
  const selectedVisibleState = selectedState(filtered, selectedListIds);
  const selectedVisibleCount = filtered.filter((item) => selectedListIds.has(item.id)).length;
  const selectedListItems = items.filter((item) => selectedListIds.has(item.id));
  const selectedToggleableItems = selectedListItems.filter((item) => item.kind !== "session-derived");
  const selectedBatchEnabled = selectedToggleableItems.some((item) => item.enabled);

  function setListSelection(ids: string[], wanted: boolean) {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (wanted) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function toggleSelectedItems(enabled: boolean) {
    const targets = selectedToggleableItems.filter((item) => item.enabled !== enabled);
    if (targets.length === 0) {
      const skipped = selectedListItems.length - selectedToggleableItems.length;
      setStatus(skipped > 0 ? `No selected toggleable items needed changes. Skipped ${skipped} inspect-only item${skipped === 1 ? "" : "s"}.` : "No selected items needed changes.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus(`${enabled ? "Enabling" : "Disabling"} ${targets.length} selected item${targets.length === 1 ? "" : "s"}...`);
    try {
      for (const item of targets) {
        const response = await fetch(`/api/items/${item.id}/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Failed to toggle ${item.name}`);
      }
      const skipped = selectedListItems.length - selectedToggleableItems.length;
      setStatus(
        `${enabled ? "Enabled" : "Disabled"} ${targets.length} selected item${targets.length === 1 ? "" : "s"}${
          skipped > 0 ? `; skipped ${skipped} inspect-only item${skipped === 1 ? "" : "s"}` : ""
        }.`
      );
      await loadItems();
      if (selected) await loadDetail(selected.id).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch toggle failed");
      setStatus("");
      await loadItems();
    } finally {
      setBusy(false);
    }
  }

  function clearUsageFilter() {
    setUsageValue("");
  }

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
              <p className="mt-0.5 text-[11px] text-muted-foreground">Inventory across Claude Code, Codex &amp; Agents</p>
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
              <StatPill label="Agents" value={formatNumber(toolTotals.agents ?? 0)} />
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
              onClick={() => setDiagnosticsOpen(true)}
              disabled={loading}
              className="h-9 px-3"
            >
              <Stethoscope className="size-3.5" strokeWidth={1.75} />
              <span className="font-mono text-[12px]">Diagnostics</span>
            </Button>
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

          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">Tool</div>
          <div className="mb-3 flex rounded-md border border-border bg-card p-0.5 card-edge">
            {(["all", "claude", "codex", "agents"] as const).map((key) => (
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
                {key === "all" ? "All" : key === "claude" ? "Claude" : key === "codex" ? "Codex" : "Agents"}
              </button>
            ))}
          </div>

          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">Origin</div>
          <div className="mb-5 flex rounded-md border border-border bg-card p-0.5 card-edge" title="Built-in tools ship with the CLI (Anthropic/Codex); custom items are user-installed.">
            {(["all", "builtin", "custom"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setOrigin(key)}
                className={`relative flex-1 rounded-[6px] px-2 py-1.5 text-[12px] font-medium transition-all duration-150 press ${
                  origin === key
                    ? "bg-foreground text-background shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {key === "all" ? "All" : key === "builtin" ? "Built-in" : "Custom"}
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
          {/* Startup probe hidden for now — not ready.
          <StartupProbePanel probe={startupProbe} activeTool={tool} loading={contextProbeLoading} onRefresh={() => void loadStartupProbe()} /> */}
        </aside>

        <section className="min-w-0">
          <div className="mb-3 grid gap-2">
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 transition-colors focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
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
            <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-card pl-3 pr-2 card-edge transition-colors focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Filter by uses</span>
              <div className="flex shrink-0 items-center gap-0.5 rounded-[6px] border border-border bg-background/60 p-0.5">
                {(["lt", "eq", "gt"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setUsageOperator(key)}
                    className={`flex h-6 min-w-6 items-center justify-center rounded-[4px] px-1.5 font-mono text-[12px] transition-colors press ${
                      usageOperator === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                    aria-label={key === "lt" ? "Usage less than" : key === "eq" ? "Usage equal to" : "Usage greater than"}
                  >
                    {key === "lt" ? "<" : key === "eq" ? "=" : ">"}
                  </button>
                ))}
              </div>
              <input
                aria-label="Usage filter number"
                className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-muted-foreground/60"
                inputMode="numeric"
                pattern="[0-9]*"
                value={usageValue}
                onChange={(event) => setUsageValue(event.target.value)}
                placeholder="any count"
              />
              {usageValue ? (
                <button
                  type="button"
                  onClick={clearUsageFilter}
                  className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                  aria-label="Clear usage filter"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div> : null}
          <div
            ref={inventoryViewportRef}
            className="h-[calc(100dvh-186px)] overflow-y-auto rounded-md"
            onScroll={(event) => setInventoryScrollTop(event.currentTarget.scrollTop)}
          >
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
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-3.5 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <label className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
                        <TriCheckbox
                          state={selectedVisibleState}
                          onChange={(checked) => setListSelection(filtered.map((item) => item.id), checked)}
                        />
                        <span className="truncate">Select all visible</span>
                      </label>
                      <label
                        className={`flex shrink-0 items-center gap-1.5 border-l border-border/70 pl-3 text-[11px] ${
                          selectedToggleableItems.length === 0 ? "text-muted-foreground/50" : "text-muted-foreground"
                        }`}
                      >
                        <span className="font-mono uppercase tracking-[0.12em]">{selectedBatchEnabled ? "On" : "Off"}</span>
                        <Switch
                          checked={selectedBatchEnabled}
                          disabled={busy || selectedToggleableItems.length === 0}
                          onCheckedChange={(checked) => void toggleSelectedItems(checked)}
                        />
                      </label>
                      <div className="flex shrink-0 items-center gap-2 border-l border-border/70 pl-3 text-[11px] text-muted-foreground">
                        <span className="font-mono uppercase tracking-[0.12em]">Sort usage</span>
                        <div className="flex h-7 items-center gap-1 rounded-md border border-border bg-card p-1 card-edge">
                          {(["desc", "asc"] as const).map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setUsageSortOrder(key)}
                              className={`flex h-5 min-w-8 items-center justify-center rounded-[5px] px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors press ${
                                usageSortOrder === key
                                  ? "bg-foreground text-background"
                                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                              }`}
                              aria-label={key === "desc" ? "Sort usage descending" : "Sort usage ascending"}
                            >
                              {key}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {selectedVisibleCount}/{filtered.length} selected
                    </span>
                  </div>
                  <ul className="divide-y divide-border/70" style={{ paddingTop: virtualPaddingTop, paddingBottom: virtualPaddingBottom }}>
                    {visibleItems.map((item, index) => {
                      const absoluteIndex = visibleStart + index;
                      const isActive = selected?.id === item.id;
                      const isChecked = selectedListIds.has(item.id);
                      const usage = usageById[item.id];
                      const invalid = item.category === "skills" && !item.valid;
                      return (
                        <li
                          key={item.id}
                          className="row-mount h-[86px]"
                          style={{ ["--index" as any]: absoluteIndex < 24 ? absoluteIndex : 0 }}
                        >
                          <div
                            className={`group relative flex h-full w-full items-start gap-2 px-3.5 py-3 text-left transition-colors ${
                              isActive ? "bg-muted/60" : "hover:bg-muted/40"
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors ${
                                isActive ? "bg-primary" : item.enabled ? "bg-primary/40" : "bg-transparent"
                              }`}
                            />
                            <div className="mt-0.5 shrink-0 pt-0.5">
                              <TriCheckbox
                                state={isChecked ? "all" : "none"}
                                onChange={(checked) => setListSelection([item.id], checked)}
                              />
                            </div>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-start gap-2 text-left press"
                              onClick={() => void loadDetail(item.id)}
                            >
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
                                  {item.builtin ? (
                                    <span
                                      className="shrink-0 rounded-sm bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-sky-600 dark:text-sky-400"
                                      title="Ships with the CLI (Anthropic/OpenAI)"
                                    >
                                      built-in
                                    </span>
                                  ) : null}
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
                                  <span>{item.tool === "claude" ? "Claude" : item.tool === "codex" ? "Codex" : "Agents"}</span>
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
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
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
                    {selected.builtin ? (
                      <span
                        className="rounded-full bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sky-600 dark:text-sky-400"
                        title="Ships with the CLI (Anthropic/OpenAI)"
                      >
                        built-in
                      </span>
                    ) : null}
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
                  <Field label="Origin" value={selected.builtin ? `Built-in (${selected.tool === "claude" ? "Anthropic" : "OpenAI"})` : "Custom"} />
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
      {diagnosticsOpen ? (
        <DiagnosticsDialog
          items={items}
          busy={busy}
          onClose={() => setDiagnosticsOpen(false)}
          onToggleItem={(item, enabled) => toggleItem(item, enabled)}
          onDisableMany={(targets) => disableManyItems(targets)}
          onInspect={(id) => {
            setDiagnosticsOpen(false);
            void loadDetail(id);
          }}
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
