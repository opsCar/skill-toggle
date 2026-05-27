import React from "react";
import ReactDOM from "react-dom/client";
import { BarChart3, BookOpen, Boxes, Check, ChevronDown, ChevronRight, Code2, Download, FileJson, FolderCog, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import "./index.css";

type ToolName = "claude" | "codex";
type Category = "skills" | "mcp" | "hooks" | "rules";

interface InventoryItem {
  id: string;
  tool: ToolName;
  category: Category;
  kind: "path" | "config-entry";
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

const categories: Array<{ key: Category | "all"; label: string; icon: React.ElementType }> = [
  { key: "all", label: "All", icon: Boxes },
  { key: "skills", label: "Skills", icon: BookOpen },
  { key: "mcp", label: "MCP", icon: FileJson },
  { key: "hooks", label: "Hooks", icon: Code2 },
  { key: "rules", label: "Rules", icon: ShieldCheck }
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
  const [exportOpen, setExportOpen] = React.useState(false);
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
      const blob = await response.blob();
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
    }
  }

  async function replaceImportArchive(file: File) {
    setBusy(true);
    setError("");
    setImportFile(null);
    setImportInspection(null);
    setStatus(`Replacing env from ${file.name} — backing up current env first...`);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: file
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Import failed");
      setStatus(`Replaced env from ${data.restoredSources?.join(", ") ?? "archive"}. Pre-import backup at ${data.preImportBackup}.`);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function inspectImportArchive(file: File) {
    setBusy(true);
    setError("");
    setStatus(`Scanning ${file.name}...`);
    try {
      const response = await fetch("/api/import/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: file
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Archive scan failed");
      setImportInspection(data);
      setStatus(`Scanned ${file.name}: ${data.items?.length ?? 0} importable items.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive scan failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function appendImportArchive(token: string, itemIds: string[]) {
    setBusy(true);
    setError("");
    setStatus(`Appending ${itemIds.length} item${itemIds.length === 1 ? "" : "s"} from archive...`);
    try {
      const response = await fetch("/api/import/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, itemIds })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Append import failed");
      setImportFile(null);
      setImportInspection(null);
      setStatus(`Appended ${data.appendedItems?.length ?? itemIds.length} item${(data.appendedItems?.length ?? itemIds.length) === 1 ? "" : "s"} from archive.`);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Append import failed");
      setStatus("");
    } finally {
      setBusy(false);
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

  return (
    <main className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Skill Toggle</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length} items · {enabledCount} enabled · {toolTotals.claude ?? 0} Claude Code · {toolTotals.codex ?? 0} Codex · {usageTotal} observed uses
              · {formatNumber(contextTotal)} est. context tokens
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={importInputRef} type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" className="hidden" onChange={onImportPicked} />
            <Button variant="outline" onClick={() => setExportOpen(true)} disabled={busy || loading || items.length === 0}>
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={busy || loading}>
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button variant="outline" onClick={() => void loadItems()} disabled={loading || busy}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
        {status ? <div className="mx-auto max-w-[1500px] px-6 pb-3 text-xs text-muted-foreground">{status}</div> : null}
        {usageLoading ? <div className="mx-auto max-w-[1500px] px-6 pb-3 text-xs text-muted-foreground">Scanning user-level Claude/Codex history...</div> : null}
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[280px_minmax(360px,520px)_1fr] gap-0 px-6 py-6">
        <aside className="border-r pr-4">
          <div className="mb-5 flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </div>
          <div className="space-y-2">
            {categories.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-sm transition-colors ${
                  category === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
                onClick={() => setCategory(key)}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
                <span>{key === "all" ? itemsForTool.length : categoryCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {(["all", "claude", "codex"] as const).map((key) => (
              <button
                key={key}
                className={`h-9 rounded-md border text-sm capitalize ${tool === key ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}
                onClick={() => setTool(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </aside>

        <section className="border-r px-4">
          <label className="mb-3 flex h-10 items-center gap-2 rounded-md border bg-card px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, path, or source"
            />
          </label>
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <ScrollArea className="h-[calc(100vh-170px)]">
            <div className="space-y-2 pr-3">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading inventory...</div>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    className={`w-full rounded-md border bg-card p-3 text-left transition-colors hover:border-primary/60 ${
                      selected?.id === item.id ? "border-primary shadow-sm" : ""
                    }`}
                    onClick={() => void loadDetail(item.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{item.name}</span>
                          {item.category === "skills" && !item.valid ? (
                            <span className="shrink-0 rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                              invalid
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                          <span className="rounded-sm bg-muted px-1.5 py-0.5">{item.tool}</span>
                          <span className="rounded-sm bg-muted px-1.5 py-0.5">{item.category}</span>
                          <span className="rounded-sm bg-muted px-1.5 py-0.5">{item.kind}</span>
                        </div>
                      </div>
                      <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${item.enabled ? "bg-primary" : "bg-muted-foreground"}`} />
                    </div>
                    <div className="mt-2 truncate text-xs text-muted-foreground">
                      {item.category === "skills" && !item.valid ? item.invalidReason ?? "Skill is invalid" : item.description}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      <span>{usageById[item.id]?.total ?? 0} uses</span>
                      {usageById[item.id]?.lastUsed ? <span>· last {formatDate(usageById[item.id]?.lastUsed ?? "")}</span> : null}
                      <span>· {formatNumber(item.context.estimatedTokens)} est. tokens</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="pl-4">
          {selected ? (
            <div className="h-[calc(100vh-122px)]">
              <div className="mb-4 flex items-start justify-between gap-4 border-b pb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-xl font-semibold">{selected.name}</h2>
                    {selected.enabled ? <Check className="h-4 w-4 text-primary" /> : null}
                    {selected.category === "skills" && !selected.valid ? (
                      <span className="rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                        invalid
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">{selected.path ?? selected.backupPath}</div>
                  {selected.category === "skills" && !selected.valid ? (
                    <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {selected.invalidReason ?? "Skill is invalid"}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
                  <span className="text-sm">{selected.enabled ? "Enabled" : "Disabled"}</span>
                  <Switch checked={selected.enabled} onCheckedChange={(checked) => void toggleItem(selected, checked)} />
                </div>
              </div>
              <div className="mb-3 grid grid-cols-4 gap-2 text-xs">
                <Info label="Tool" value={selected.tool} />
                <Info label="Category" value={selected.category} />
                <Info label="Kind" value={selected.kind} />
                <Info label="Source" value={selected.source} />
              </div>
              <div className="mb-3 grid grid-cols-5 gap-2 text-xs">
                <Info label="Uses" value={String(selectedUsage?.total ?? 0)} />
                <Info label="Claude" value={String(selectedUsage?.claude ?? 0)} />
                <Info label="Codex" value={String(selectedUsage?.codex ?? 0)} />
                <Info label="Signal" value={usageSignal(selectedUsage)} />
                <Info label="Last used" value={selectedUsage?.lastUsed ? formatDate(selectedUsage.lastUsed) : "none"} />
              </div>
              <div className="mb-3 grid grid-cols-4 gap-2 text-xs">
                <Info label="Est. tokens" value={formatNumber(selected.context.estimatedTokens)} />
                <Info label="Characters" value={formatNumber(selected.context.characters)} />
                <Info label="Bytes" value={formatBytes(selected.context.bytes)} />
                <Info label="Lines" value={formatNumber(selected.context.lines)} />
              </div>
              <div className="mb-3 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                Context estimate uses {selected.context.charsPerToken} characters per token against the readable detail/config payload for this item.
              </div>
              {selectedUsage?.evidence?.length ? (
                <div className="mb-3 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Usage evidence</div>
                  {selectedUsage.evidence.map((entry) => (
                    <div key={entry} className="truncate">
                      {entry}
                    </div>
                  ))}
                </div>
              ) : null}
              <ScrollArea className="h-[calc(100vh-380px)] rounded-md border bg-card">
                <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-6">{selected.detail}</pre>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex h-[calc(100vh-122px)] items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
              Select an item
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
  mcp: "MCP",
  hooks: "Hooks",
  rules: "Rules"
};

const CATEGORY_ORDER: Category[] = ["skills", "mcp", "hooks", "rules"];

interface ExportSelection {
  filename: string;
  itemIds: string[];
  saveHandle?: FileSystemFileHandle | null;
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
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(["tool:claude", "tool:codex"]));

  const supportsFilePicker = typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

  const groups = React.useMemo(() => {
    const map = new Map<ToolName, Map<Category, InventoryItem[]>>();
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
    const tools = Array.from(map.keys()).sort();
    return tools.map((tool) => {
      const toolMap = map.get(tool)!;
      const cats = CATEGORY_ORDER.filter((cat) => toolMap.has(cat)).map((cat) => ({
        category: cat,
        items: (toolMap.get(cat) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
      }));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Export setup</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick a filename, optional save location, and the scope to include. {totalSelected} of {items.length} items selected.
            </p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 border-b px-5 py-4 sm:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Filename</span>
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
              value={filename}
              onChange={(event) => {
                setFilename(event.target.value);
                if (saveHandle) setSaveHandle(null);
              }}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Save location</span>
            {supportsFilePicker ? (
              <Button type="button" variant="outline" onClick={() => void chooseLocation()}>
                <FolderCog className="h-4 w-4" />
                {saveHandle ? "Change…" : "Choose…"}
              </Button>
            ) : (
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                Browser Downloads folder
              </div>
            )}
            {saveHandle ? <span className="truncate text-[11px] text-muted-foreground">→ {saveHandle.name}</span> : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-b px-5 py-2 text-xs">
          <span className="text-muted-foreground">Scope (everything pre-selected by default)</span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border px-2 py-1 hover:bg-muted"
              onClick={() => setSelected(new Set(items.map((item) => item.id)))}
            >
              Select all
            </button>
            <button className="rounded-md border px-2 py-1 hover:bg-muted" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>

        <ScrollArea className="h-[420px]">
          <div className="px-5 py-3">
            {groups.map(({ tool, categories: catGroups }) => {
              const toolItems = catGroups.flatMap((group) => group.items);
              const toolKey = `tool:${tool}`;
              const toolStatus = toolState(toolItems);
              const isExpanded = expanded.has(toolKey);
              return (
                <div key={tool} className="mb-3 rounded-md border">
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <button
                      onClick={() => toggleExpanded(toolKey)}
                      className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <TriCheckbox
                      state={toolStatus}
                      onChange={(checked) => setMany(toolItems.map((item) => item.id), checked)}
                    />
                    <div className="flex-1 text-sm font-medium">{TOOL_LABELS[tool]}</div>
                    <span className="text-xs text-muted-foreground">{toolItems.filter((item) => selected.has(item.id)).length}/{toolItems.length}</span>
                  </div>
                  {isExpanded ? (
                    <div className="space-y-1 px-3 py-2">
                      {catGroups.map(({ category, items: catItems }) => {
                        const catKey = `cat:${tool}:${category}`;
                        const catExpanded = expanded.has(catKey);
                        let onCount = 0;
                        for (const item of catItems) if (selected.has(item.id)) onCount += 1;
                        const catStatus: "all" | "some" | "none" = onCount === 0 ? "none" : onCount === catItems.length ? "all" : "some";
                        return (
                          <div key={category} className="rounded-md border bg-muted/20">
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <button
                                onClick={() => toggleExpanded(catKey)}
                                className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
                                aria-label={catExpanded ? "Collapse" : "Expand"}
                              >
                                {catExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </button>
                              <TriCheckbox state={catStatus} onChange={(checked) => setMany(catItems.map((item) => item.id), checked)} />
                              <div className="flex-1 text-sm">{CATEGORY_LABELS[category]}</div>
                              <span className="text-[11px] text-muted-foreground">{onCount}/{catItems.length}</span>
                            </div>
                            {catExpanded ? (
                              <div className="space-y-0.5 border-t bg-background px-3 py-2">
                                {catItems.map((item) => {
                                  const isOn = selected.has(item.id);
                                  return (
                                    <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60">
                                      <TriCheckbox
                                        state={isOn ? "all" : "none"}
                                        onChange={(checked) => setMany([item.id], checked)}
                                      />
                                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{item.enabled ? "on" : "off"}</span>
                                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.kind === "path" ? "path" : "config"}</span>
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
              <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">No items detected in your environment.</div>
            ) : null}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleExport} disabled={totalSelected === 0}>
            <Download className="h-4 w-4" />
            Export {totalSelected} item{totalSelected === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({
  file,
  inspection,
  busy,
  onCancel,
  onReplace,
  onInspect,
  onAppend
}: {
  file: File;
  inspection: ImportInspection | null;
  busy: boolean;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Import archive</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 border-b px-5 py-4 sm:grid-cols-2">
          <button
            className={`rounded-md border p-3 text-left ${mode === "replace" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            onClick={() => setMode("replace")}
          >
            <div className="text-sm font-medium">Replace current</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Completely replace local Claude/Codex env with this archive. A pre-import backup is created first.
            </div>
          </button>
          <button
            className={`rounded-md border p-3 text-left ${mode === "append" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            onClick={() => setMode("append")}
          >
            <div className="text-sm font-medium">Append selected</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Scan the archive and add only selected skills, MCP entries, hooks, or rules to the current env.
            </div>
          </button>
        </div>

        {mode === "replace" ? (
          <div className="px-5 py-5 text-sm text-muted-foreground">
            This mode replaces the archive's top-level env folders, including matching disabled-item backups, after writing a backup tar under
            <span className="font-mono"> ~/.skill-toggle-backups/</span>.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b px-5 py-2 text-xs">
              <span className="text-muted-foreground">
                {inspection ? `${totalSelected} of ${inspection.items.length} archive items selected` : "Scan the tar archive before selecting items."}
              </span>
              {inspection ? (
                <div className="flex items-center gap-2">
                  <button className="rounded-md border px-2 py-1 hover:bg-muted" onClick={() => setSelected(new Set(inspection.items.map((item) => item.id)))}>
                    Select all
                  </button>
                  <button className="rounded-md border px-2 py-1 hover:bg-muted" onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
            <ScrollArea className="h-[420px]">
              <div className="px-5 py-3">
                {!inspection ? (
                  <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">Archive contents have not been scanned yet.</div>
                ) : groups.length === 0 ? (
                  <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">No importable items found in this archive.</div>
                ) : (
                  groups.map(({ tool, categories: catGroups }) => {
                    const toolItems = catGroups.flatMap((group) => group.items);
                    const toolKey = `tool:${tool}`;
                    const toolStatus = selectedState(toolItems, selected);
                    const isExpanded = expanded.has(toolKey);
                    return (
                      <div key={tool} className="mb-3 rounded-md border">
                        <div className="flex items-center gap-2 border-b px-3 py-2">
                          <button
                            onClick={() => toggleExpanded(toolKey)}
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <TriCheckbox state={toolStatus} onChange={(checked) => setMany(toolItems.map((item) => item.id), checked)} />
                          <div className="flex-1 text-sm font-medium">{TOOL_LABELS[tool]}</div>
                          <span className="text-xs text-muted-foreground">{toolItems.filter((item) => selected.has(item.id)).length}/{toolItems.length}</span>
                        </div>
                        {isExpanded ? (
                          <div className="space-y-1 px-3 py-2">
                            {catGroups.map(({ category, items: catItems }) => {
                              const catKey = `cat:${tool}:${category}`;
                              const catExpanded = expanded.has(catKey);
                              const catStatus = selectedState(catItems, selected);
                              return (
                                <div key={category} className="rounded-md border bg-muted/20">
                                  <div className="flex items-center gap-2 px-3 py-1.5">
                                    <button
                                      onClick={() => toggleExpanded(catKey)}
                                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
                                      aria-label={catExpanded ? "Collapse" : "Expand"}
                                    >
                                      {catExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    </button>
                                    <TriCheckbox state={catStatus} onChange={(checked) => setMany(catItems.map((item) => item.id), checked)} />
                                    <div className="flex-1 text-sm">{CATEGORY_LABELS[category]}</div>
                                    <span className="text-[11px] text-muted-foreground">{catItems.filter((item) => selected.has(item.id)).length}/{catItems.length}</span>
                                  </div>
                                  {catExpanded ? (
                                    <div className="space-y-0.5 border-t bg-background px-3 py-2">
                                      {catItems.map((item) => {
                                        const isOn = selected.has(item.id);
                                        return (
                                          <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60">
                                            <TriCheckbox state={isOn ? "all" : "none"} onChange={(checked) => setMany([item.id], checked)} />
                                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                            <span className="truncate text-xs text-muted-foreground">{item.archivePath}</span>
                                            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.kind === "path" ? "path" : "config"}</span>
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

        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          {mode === "replace" ? (
            <Button onClick={onReplace} disabled={busy}>
              <Upload className="h-4 w-4" />
              Replace current
            </Button>
          ) : !inspection ? (
            <Button onClick={onInspect} disabled={busy}>
              <Search className="h-4 w-4" />
              Scan archive
            </Button>
          ) : (
            <Button onClick={() => onAppend(Array.from(selected))} disabled={busy || totalSelected === 0}>
              <Upload className="h-4 w-4" />
              Append {totalSelected} item{totalSelected === 1 ? "" : "s"}
            </Button>
          )}
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
    const cats = CATEGORY_ORDER.filter((cat) => toolMap.has(cat)).map((cat) => ({
      category: cat,
      items: (toolMap.get(cat) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
    }));
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
      className="h-4 w-4 cursor-pointer accent-primary"
      checked={state === "all"}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
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
    ["rule", usage.rule]
  ];
  return rows.sort((a, b) => b[1] - a[1])[0][0];
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-card p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
