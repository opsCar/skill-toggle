import React from "react";
import { ChevronDown, ChevronRight, Download, FolderCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TriCheckbox } from "@/components/primitives";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  TOOL_LABELS,
  type Category,
  type ExportSelection,
  type InventoryItem,
  type ToolName
} from "@/types";

export function ExportDialog({
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
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(["tool:claude", "tool:codex", "tool:agents"]));

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
          ? [
              {
                category: cat,
                items: (toolMap.get(cat) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
              }
            ]
          : []
      );
      return { tool, categories: cats };
    });
  }, [exportableItems]);

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
                                      <TriCheckbox state={isOn ? "all" : "none"} onChange={(checked) => setMany([item.id], checked)} />
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
