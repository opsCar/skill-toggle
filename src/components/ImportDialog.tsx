import React from "react";
import { ChevronDown, ChevronRight, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TriCheckbox } from "@/components/primitives";
import { formatBytes, groupItems, selectedState } from "@/lib/format";
import { CATEGORY_LABELS, TOOL_LABELS, type ImportInspection } from "@/types";

export function ImportDialog({
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
