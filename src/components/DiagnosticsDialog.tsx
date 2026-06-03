import React from "react";
import { Activity, ArrowLeft, Check, ChevronRight, Eye, MessagesSquare, Plus, Search, Stethoscope, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TriCheckbox } from "@/components/primitives";
import {
  CATEGORY_LABELS,
  OVERLAP_METHOD_LABELS,
  TOOL_LABELS,
  type DiagnosticRun,
  type DiagnosticRunSummary,
  type DiagnosticsCapability,
  type Finding,
  type FindingItemRef,
  type InventoryItem,
  type LlmTrace,
  type OverlapMethod,
  type Severity
} from "@/types";

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

const SEVERITY_STYLES: Record<Severity, { dot: string; chip: string; label: string }> = {
  high: { dot: "bg-destructive", chip: "bg-destructive/10 text-destructive", label: "High" },
  medium: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: "Medium" },
  low: { dot: "bg-muted-foreground/50", chip: "bg-muted text-muted-foreground", label: "Low" }
};

function severitySummary(counts: Record<Severity, number>): string {
  const parts = SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  return parts.length ? parts.join(" · ") : "no findings";
}

function formatStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DiagnosticsDialog({
  items,
  busy,
  onClose,
  onToggleItem,
  onDisableMany,
  onInspect
}: {
  items: InventoryItem[];
  busy: boolean;
  onClose: () => void;
  onToggleItem: (item: InventoryItem, enabled: boolean) => Promise<void> | void;
  onDisableMany: (items: InventoryItem[]) => Promise<void> | void;
  onInspect: (id: string) => void;
}) {
  const [runs, setRuns] = React.useState<DiagnosticRunSummary[]>([]);
  const [capabilities, setCapabilities] = React.useState<DiagnosticsCapability[]>([]);
  const [run, setRun] = React.useState<DiagnosticRun | null>(null);
  const [view, setView] = React.useState<"history" | "picker" | "detail">("history");
  const [method, setMethod] = React.useState<OverlapMethod>("lexical");
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState("");

  const liveById = React.useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, capsRes] = await Promise.all([
        fetch("/api/diagnostics/runs").then((r) => r.json()),
        fetch("/api/diagnostics/capabilities").then((r) => r.json())
      ]);
      setRuns(runsRes.runs ?? []);
      setCapabilities(capsRes.methods ?? []);
    } catch {
      setError("Could not load diagnostics history.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function openRun(id: string) {
    setError("");
    try {
      const data = await fetch(`/api/diagnostics/runs/${encodeURIComponent(id)}`).then((r) => r.json());
      setRun(data);
      setView("detail");
    } catch {
      setError("Could not open that run.");
    }
  }

  async function runDiagnostics() {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/diagnostics/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlapMethod: method })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Run failed");
      setRun(data);
      setView("detail");
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex h-[min(86vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl card-edge">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {view !== "history" ? (
              <button
                type="button"
                onClick={() => {
                  setView("history");
                  setRun(null);
                  setError("");
                }}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors press hover:bg-muted hover:text-foreground"
                aria-label="Back to history"
              >
                <ArrowLeft className="size-4" strokeWidth={1.75} />
              </button>
            ) : (
              <Stethoscope className="size-4 text-muted-foreground" strokeWidth={1.75} />
            )}
            <div>
              <h2 className="text-[15px] font-semibold tracking-tightish">
                {view === "detail" ? "Diagnostic run" : view === "picker" ? "New diagnostic" : "Diagnostics"}
              </h2>
              {view === "detail" && run ? (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {formatStamp(run.createdAt)} · {OVERLAP_METHOD_LABELS[run.overlapMethod]} overlap · {severitySummary(run.counts)}
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">Config that costs context without earning its keep.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {view === "history" ? (
              <Button size="sm" variant="primary" onClick={() => setView("picker")} disabled={loading}>
                <Plus className="size-3.5" strokeWidth={2} />
                New run
              </Button>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {error ? <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-[12px] text-destructive">{error}</div> : null}

        {view === "picker" ? (
          <MethodPicker
            capabilities={capabilities}
            method={method}
            running={running}
            onPick={setMethod}
            onRun={() => void runDiagnostics()}
          />
        ) : view === "detail" && run ? (
          <RunDetail run={run} liveById={liveById} busy={busy} onToggleItem={onToggleItem} onDisableMany={onDisableMany} onInspect={onInspect} />
        ) : (
          <HistoryList runs={runs} loading={loading} onOpen={(id) => void openRun(id)} />
        )}
      </div>
    </div>
  );
}

function MethodPicker({
  capabilities,
  method,
  running,
  onPick,
  onRun
}: {
  capabilities: DiagnosticsCapability[];
  method: OverlapMethod;
  running: boolean;
  onPick: (method: OverlapMethod) => void;
  onRun: () => void;
}) {
  const order: OverlapMethod[] = ["lexical", "semantic", "llm"];
  const caps = new Map(capabilities.map((c) => [c.method, c]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 text-[12.5px] text-muted-foreground">
          Low-usage and overlap rules run together. Pick how overlapping skills and agents are detected.
        </div>
        <div className="space-y-2">
          {order.map((key) => {
            const cap = caps.get(key);
            const available = cap?.available ?? key === "lexical";
            const active = method === key;
            return (
              <button
                key={key}
                type="button"
                disabled={!available}
                onClick={() => available && onPick(key)}
                className={`relative flex w-full items-start gap-3 overflow-hidden rounded-md border p-3 text-left transition-all press disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? "border-foreground/30 bg-card card-edge" : "border-border hover:bg-muted/40"
                }`}
              >
                {active ? <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" /> : null}
                <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-primary" : "border-border"}`}>
                  {active ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{OVERLAP_METHOD_LABELS[key]} overlap</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {key === "lexical"
                      ? "Instant, offline keyword-set similarity. Honest that it is lexical, not semantic."
                      : key === "semantic"
                        ? "On-device embeddings, fully offline."
                        : "Asks the local Claude CLI to judge redundancy."}
                  </div>
                  {!available && cap?.reason ? <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/80">{cap.reason}</div> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
        <Button variant="primary" onClick={onRun} disabled={running}>
          {running ? <Activity className="size-3.5 animate-pulse" strokeWidth={2} /> : <Stethoscope className="size-3.5" strokeWidth={1.75} />}
          {running ? "Running…" : "Run diagnostics"}
        </Button>
      </div>
    </div>
  );
}

function HistoryList({ runs, loading, onOpen }: { runs: DiagnosticRunSummary[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Stethoscope className="size-5" strokeWidth={1.5} />
        </div>
        <div className="text-[13px] font-medium">No diagnostics yet</div>
        <div className="mt-1 text-[12px] text-muted-foreground">Run one with the New run button.</div>
      </div>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="divide-y divide-border/70">
        {runs.map((row) => (
          <li key={row.id}>
            <button type="button" onClick={() => onOpen(row.id)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-1.5">
                {SEVERITY_ORDER.map((s) => (
                  <span key={s} className={`size-2 rounded-full ${row.counts[s] > 0 ? SEVERITY_STYLES[s].dot : "bg-border"}`} title={`${row.counts[s]} ${s}`} />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium tracking-tightish">{formatStamp(row.createdAt)}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {OVERLAP_METHOD_LABELS[row.overlapMethod]} · {severitySummary(row.counts)}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 -translate-x-1 text-muted-foreground/0 transition-all group-hover:translate-x-0 group-hover:text-muted-foreground" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

type SortKey = "severity" | "usage" | "name" | "token";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "severity", label: "Severity" },
  { key: "usage", label: "Usage" },
  { key: "name", label: "Name" },
  { key: "token", label: "Tokens" }
];

function findingName(f: Finding): string {
  return f.items[0]?.name ?? f.title;
}

function findingTokens(f: Finding, liveById: Map<string, InventoryItem>): number {
  if (typeof f.metrics.tokens === "number") return f.metrics.tokens;
  let sum = 0;
  for (const ref of f.items) sum += liveById.get(ref.id)?.context.estimatedTokens ?? 0;
  return sum;
}

// Overlap findings carry no usage metric — sort them last when ordering by least-used.
function findingUses(f: Finding): number {
  return typeof f.metrics.uses === "number" ? f.metrics.uses : Number.POSITIVE_INFINITY;
}

function matchesQuery(f: Finding, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return f.title.toLowerCase().includes(needle) || f.items.some((ref) => ref.name.toLowerCase().includes(needle));
}

function sortFindings(findings: Finding[], key: SortKey, liveById: Map<string, InventoryItem>): Finding[] {
  const arr = [...findings];
  if (key === "usage") arr.sort((a, b) => findingUses(a) - findingUses(b));
  else if (key === "token") arr.sort((a, b) => findingTokens(b, liveById) - findingTokens(a, liveById));
  else if (key === "name") arr.sort((a, b) => findingName(a).localeCompare(findingName(b)));
  return arr;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function TranscriptStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-[0.1em] text-muted-foreground/70">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function TranscriptSection({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-b border-border/70 last:border-b-0">
      <div className="px-3.5 pt-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-3.5 py-2 text-[11.5px] leading-relaxed text-foreground/90">{body}</pre>
    </div>
  );
}

// The full LLM exchange behind an "LLM" overlap run — what we asked, what the
// model said, and what it cost. Shown only when the run carries a trace.
function LlmTranscript({ trace }: { trace: LlmTrace }) {
  const [open, setOpen] = React.useState(true);
  const u = trace.usage;
  const summary = [
    u?.inputTokens != null ? `${formatTokens(u.inputTokens)} in` : null,
    u?.outputTokens != null ? `${formatTokens(u.outputTokens)} out` : null,
    u?.costUsd != null ? `$${u.costUsd.toFixed(4)}` : null
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border bg-card card-edge">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left press"
        aria-expanded={open}
      >
        <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2} />
        <MessagesSquare className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        <span className="text-[13px] font-medium tracking-tightish">LLM transcript</span>
        {summary ? <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{summary}</span> : null}
      </button>
      {open ? (
        <div className="border-t border-border/70">
          {u ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-border/70 bg-muted/25 px-3.5 py-2.5 font-mono text-[11px]">
              <TranscriptStat label="Input" value={u.inputTokens != null ? formatTokens(u.inputTokens) : "—"} />
              <TranscriptStat label="Output" value={u.outputTokens != null ? formatTokens(u.outputTokens) : "—"} />
              <TranscriptStat label="Cache read" value={u.cacheReadTokens != null ? formatTokens(u.cacheReadTokens) : "—"} />
              <TranscriptStat label="Cost" value={u.costUsd != null ? `$${u.costUsd.toFixed(4)}` : "—"} />
              <TranscriptStat label="Time" value={u.durationMs != null ? `${(u.durationMs / 1000).toFixed(1)}s` : "—"} />
            </div>
          ) : null}
          <TranscriptSection title="Prompt sent" body={trace.prompt} />
          <TranscriptSection title="Model response" body={trace.response || "(empty response)"} />
        </div>
      ) : null}
    </div>
  );
}

function RunDetail({
  run,
  liveById,
  busy,
  onToggleItem,
  onDisableMany,
  onInspect
}: {
  run: DiagnosticRun;
  liveById: Map<string, InventoryItem>;
  busy: boolean;
  onToggleItem: (item: InventoryItem, enabled: boolean) => Promise<void> | void;
  onDisableMany: (items: InventoryItem[]) => Promise<void> | void;
  onInspect: (id: string) => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("severity");
  const [collapsed, setCollapsed] = React.useState<Set<Severity>>(new Set());

  const visibleFindings = React.useMemo(() => run.findings.filter((f) => matchesQuery(f, query)), [run.findings, query]);

  function toggleCollapse(severity: Severity) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  }

  // Unique items still live, enabled, and toggleable — the only ones a bulk
  // disable can act on. Deduped because an item can appear in several findings.
  const selectableItems = React.useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const finding of run.findings) {
      for (const ref of finding.items) {
        const live = liveById.get(ref.id);
        if (live && live.enabled && live.kind !== "session-derived") map.set(live.id, live);
      }
    }
    return map;
  }, [run, liveById]);

  const selectableIds = React.useMemo(() => [...selectableItems.keys()], [selectableItems]);
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length;
  const selState: "all" | "some" | "none" =
    selectedCount === 0 ? "none" : selectedCount === selectableIds.length ? "all" : "some";

  function setOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function disableSelected() {
    const targets = selectableIds.filter((id) => selected.has(id)).map((id) => selectableItems.get(id)!);
    if (targets.length === 0) return;
    await onDisableMany(targets);
    setSelected(new Set());
  }

  if (run.findings.length === 0) {
    const emptyState = (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-5" strokeWidth={2} />
        </div>
        <div className="text-[13px] font-medium">Nothing to trim</div>
        <div className="mt-1 max-w-[34ch] text-[12px] text-muted-foreground">No enabled item crossed the low-usage or overlap thresholds in this run.</div>
      </div>
    );
    if (!run.llmTrace) return <div className="flex flex-1 items-center justify-center">{emptyState}</div>;
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-4">
          <LlmTranscript trace={run.llmTrace} />
          {emptyState}
        </div>
      </ScrollArea>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selectableIds.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/25 px-5 py-2.5">
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <TriCheckbox state={selState} onChange={(checked) => setSelected(checked ? new Set(selectableIds) : new Set())} />
            <span>Select all fixable</span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">
              {selectedCount}/{selectableIds.length}
            </span>
          </label>
          <Button size="sm" variant="primary" disabled={busy || selectedCount === 0} onClick={() => void disableSelected()}>
            Disable {selectedCount || ""} selected
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-2.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 transition-colors focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            aria-label="Search findings by name"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/60"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name…"
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
        </label>
        <div className="flex shrink-0 items-center gap-0.5 rounded-[6px] border border-border bg-background/60 p-0.5">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSortKey(opt.key)}
              className={`flex h-6 items-center justify-center rounded-[4px] px-2 text-[11.5px] transition-colors press ${
                sortKey === opt.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              aria-pressed={sortKey === opt.key}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-4">
          {run.llmTrace ? <LlmTranscript trace={run.llmTrace} /> : null}
          {visibleFindings.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-muted-foreground">No findings match “{query}”.</div>
          ) : sortKey === "severity" ? (
            <div className="space-y-5">
              {SEVERITY_ORDER.map((severity) => {
                const findings = visibleFindings.filter((f) => f.severity === severity);
                if (findings.length === 0) return null;
                const isCollapsed = collapsed.has(severity);
                return (
                  <div key={severity}>
                    <button
                      type="button"
                      onClick={() => toggleCollapse(severity)}
                      className="mb-2 flex w-full items-center gap-2 press"
                      aria-expanded={!isCollapsed}
                    >
                      <ChevronRight
                        className={`size-3.5 text-muted-foreground transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                        strokeWidth={2}
                      />
                      <span className={`size-2 rounded-full ${SEVERITY_STYLES[severity].dot}`} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {SEVERITY_STYLES[severity].label} · {findings.length}
                      </span>
                    </button>
                    {isCollapsed ? null : (
                      <div className="space-y-2.5">
                        {findings.map((finding) => (
                          <FindingCard
                            key={finding.id}
                            finding={finding}
                            liveById={liveById}
                            busy={busy}
                            selected={selected}
                            onSelect={setOne}
                            onToggleItem={onToggleItem}
                            onInspect={onInspect}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2.5">
              {sortFindings(visibleFindings, sortKey, liveById).map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  liveById={liveById}
                  busy={busy}
                  selected={selected}
                  onSelect={setOne}
                  onToggleItem={onToggleItem}
                  onInspect={onInspect}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function FindingCard({
  finding,
  liveById,
  busy,
  selected,
  onSelect,
  onToggleItem,
  onInspect
}: {
  finding: Finding;
  liveById: Map<string, InventoryItem>;
  busy: boolean;
  selected: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onToggleItem: (item: InventoryItem, enabled: boolean) => Promise<void> | void;
  onInspect: (id: string) => void;
}) {
  const isOverlap = finding.ruleId === "overlap";
  return (
    <div className="rounded-lg border border-border bg-card p-3.5 card-edge">
      <div className="flex items-start gap-2">
        {isOverlap ? (
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium tracking-tightish">{finding.title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{finding.detail}</div>
        </div>
        <span className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${SEVERITY_STYLES[finding.severity].chip}`}>
          {finding.ruleId}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {finding.items.map((ref) => (
          <FindingItemRow
            key={ref.id}
            item={ref}
            liveById={liveById}
            busy={busy}
            checked={selected.has(ref.id)}
            onSelect={onSelect}
            onToggleItem={onToggleItem}
            onInspect={onInspect}
          />
        ))}
      </div>
    </div>
  );
}

function FindingItemRow({
  item,
  liveById,
  busy,
  checked,
  onSelect,
  onToggleItem,
  onInspect
}: {
  item: FindingItemRef;
  liveById: Map<string, InventoryItem>;
  busy: boolean;
  checked: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onToggleItem: (item: InventoryItem, enabled: boolean) => Promise<void> | void;
  onInspect: (id: string) => void;
}) {
  const live = liveById.get(item.id);
  const selectable = !!live && live.enabled && live.kind !== "session-derived";
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2.5 py-1.5">
      {selectable ? (
        <TriCheckbox state={checked ? "all" : "none"} onChange={(value) => onSelect(item.id, value)} />
      ) : (
        <span className="w-[14px] shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{item.name}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {TOOL_LABELS[item.tool]} · {CATEGORY_LABELS[item.category]}
        </div>
      </div>
      {live ? (
        <button
          type="button"
          onClick={() => onInspect(item.id)}
          className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors press hover:bg-muted/60 hover:text-foreground"
        >
          <Eye className="size-3" strokeWidth={1.75} />
          Inspect
        </button>
      ) : null}
      {!live ? (
        <span className="font-mono text-[10.5px] text-muted-foreground/70">— no longer present</span>
      ) : !live.enabled ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-primary">
          <Check className="size-3" strokeWidth={3} />
          Resolved
        </span>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onToggleItem(live, false)} className="h-7 px-2.5 text-[11px]">
          Disable
        </Button>
      )}
    </div>
  );
}
