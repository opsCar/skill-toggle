import React from "react";
import { Activity, ArrowLeft, BookOpenCheck, Database, RefreshCw, Search, Server, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import type { ClaudeTapBreakdownRow, ClaudeTapOverview, ClaudeTapSession, ClaudeTapSkillSignal } from "@/types";

export function SessionExplorerPage() {
  const [overview, setOverview] = React.useState<ClaudeTapOverview | null>(null);
  const [selectedId, setSelectedId] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [sessionDetail, setSessionDetail] = React.useState<ClaudeTapSession | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const loadOverview = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/claude-tap/sessions?limit=160");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Session scan failed");
      setOverview(data);
      setSelectedId((current) => current || data.sessions?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const sessions = overview?.sessions ?? [];
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      [
        session.id,
        session.agent,
        session.client,
        session.model,
        session.status,
        session.workspace ?? "",
        session.firstUser,
        session.error,
        ...session.skillActivity.loadedSkills.map((skill) => skill.name),
        ...session.skillActivity.mentionedSkills.map((skill) => skill.name)
      ].some((value) => value.toLowerCase().includes(needle))
    );
  }, [query, sessions]);
  const selected = sessions.find((session) => session.id === selectedId) ?? filtered[0] ?? null;
  const selectedWithDetail = sessionDetail?.id === selected?.id ? sessionDetail : selected;

  React.useEffect(() => {
    if (!selected?.id) {
      setSessionDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    fetch(`/api/claude-tap/sessions/${encodeURIComponent(selected.id)}`, { signal: controller.signal })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error ?? "Session detail failed");
        setSessionDetail(data.session);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Session detail failed");
      })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [selected?.id]);

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-6 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground card-edge"
              title="Back to inventory"
            >
              <ArrowLeft className="size-4" strokeWidth={1.8} />
            </a>
            <div className="relative flex size-9 items-center justify-center rounded-lg bg-foreground text-background card-edge">
              <Database className="size-[18px]" strokeWidth={1.6} />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-tightish text-foreground">Session Explorer</h1>
                <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">claude-tap</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Trace sessions, token spend, and context budget</p>
            </div>
          </div>

          <div className="hidden flex-1 items-center justify-center lg:flex">
            <div className="flex items-center gap-0 rounded-full border border-border bg-card/70 py-1 pl-1 pr-1 card-edge">
              <MetricPill label="Sessions" value={formatNumber(overview?.source.sessionCount ?? 0)} />
              <Divider />
              <MetricPill label="Records" value={formatNumber(overview?.source.recordCount ?? 0)} />
              <Divider />
              <MetricPill label="Tokens" value={formatNumber(overview?.budget.totalTokens ?? 0)} accent />
              <Divider />
              <MetricPill label="Cost" value={formatUsd(overview?.budget.estimatedCostUsd ?? 0)} accent />
              <Divider />
              <MetricPill label="Cache read" value={`${Math.round((overview?.budget.cacheReadRatio ?? 0) * 100)}%`} />
            </div>
          </div>

          <Button variant="ghost" size="icon" onClick={() => void loadOverview()} disabled={loading} title="Refresh sessions" className="size-9 text-muted-foreground hover:text-foreground">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(360px,500px)_1fr] gap-6 p-6">
        <section className="min-w-0">
          <SourcePanel overview={overview} loading={loading} error={error} />
          <div className="mt-4 flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 transition-colors focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            <input
              aria-label="Search sessions"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search prompt, model, workspace…"
            />
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{filtered.length}</span>
          </div>

          <div className="mt-3 h-[calc(100dvh-276px)] overflow-hidden rounded-md border border-border bg-card card-edge">
            <div className="h-full overflow-auto">
              {filtered.length === 0 ? (
                <div className="p-5 text-[13px] text-muted-foreground">{loading ? "Reading claude-tap sessions…" : "No sessions matched."}</div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {filtered.map((session) => (
                    <SessionRow key={session.id} session={session} selected={selected?.id === session.id} onSelect={() => setSelectedId(session.id)} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="min-w-0">
          <BudgetPanel overview={overview} />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <BreakdownPanel title="By Agent" rows={overview?.byAgent ?? []} />
            <BreakdownPanel title="By Model" rows={overview?.byModel ?? []} />
          </div>
          <SessionDetail session={selectedWithDetail} loading={detailLoading} />
        </section>
      </div>
    </main>
  );
}

function SourcePanel({ overview, loading, error }: { overview: ClaudeTapOverview | null; loading: boolean; error: string }) {
  const source = overview?.source;
  return (
    <div className="rounded-md border border-border bg-card p-4 card-edge">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <Server className="size-3.5" strokeWidth={1.8} />
          Source
        </div>
        {loading ? <Activity className="size-3.5 animate-pulse text-primary" strokeWidth={2} /> : null}
      </div>
      <div className="space-y-2 text-[12px]">
        <InfoLine label="Database" value={source?.dbPath ?? "Detecting…"} mono />
        <InfoLine label="Schema" value={source?.schemaVersion ? `v${source.schemaVersion}` : "unknown"} />
        <InfoLine label="Tables" value={source?.tables.length ? source.tables.join(", ") : "none"} />
        <InfoLine label="Size" value={source?.sizeBytes ? formatBytes(source.sizeBytes) : "—"} mono />
      </div>
      {source?.warning || error ? (
        <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          {error || source?.warning}
        </div>
      ) : null}
    </div>
  );
}

function BudgetPanel({ overview }: { overview: ClaudeTapOverview | null }) {
  const budget = overview?.budget;
  return (
    <div className="rounded-md border border-border bg-card p-4 card-edge">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <WalletCards className="size-3.5" strokeWidth={1.8} />
        Cost And Context Budget
      </div>
      <div className="grid grid-cols-4 gap-3">
        <BudgetTile label="Total tokens" value={formatNumber(budget?.totalTokens ?? 0)} accent />
        <BudgetTile label="Input" value={formatNumber(budget?.inputTokens ?? 0)} />
        <BudgetTile label="Output" value={formatNumber(budget?.outputTokens ?? 0)} />
        <BudgetTile label="Cache read" value={formatNumber(budget?.cacheReadTokens ?? 0)} />
        <BudgetTile label="Cache create" value={formatNumber(budget?.cacheCreateTokens ?? 0)} />
        <BudgetTile label="Uncached input" value={formatNumber(budget?.uncachedInputTokens ?? 0)} />
        <BudgetTile label="Avg/session" value={formatNumber(budget?.avgTokensPerSession ?? 0)} />
        <BudgetTile label="Duration" value={formatDuration(budget?.durationMs ?? 0)} />
        <BudgetTile label="Est. cost" value={formatUsd(budget?.estimatedCostUsd ?? 0)} accent />
        <BudgetTile label="Unpriced" value={formatNumber(budget?.unpricedSessions ?? 0)} />
      </div>
      {overview?.pricing ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {overview.pricing.note} Sources: {overview.pricing.sources.map((source) => source.provider).join(", ")}.
        </div>
      ) : null}
    </div>
  );
}

function BreakdownPanel({ title, rows }: { title: string; rows: ClaudeTapBreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.totalTokens));
  return (
    <div className="h-[260px] overflow-hidden rounded-md border border-border bg-card p-4 card-edge">
      <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <div className="space-y-2 overflow-auto pr-1">
        {rows.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No breakdown data.</div>
        ) : (
          rows.map((row) => (
            <div key={row.key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
                <span className="truncate font-medium">{row.key}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatUsd(row.estimatedCostUsd)}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatNumber(row.totalTokens)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(3, (row.totalTokens / max) * 100)}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SessionDetail({ session, loading }: { session: ClaudeTapSession | null; loading: boolean }) {
  if (!session) {
    return (
      <div className="mt-4 rounded-md border border-border bg-card p-5 text-[13px] text-muted-foreground card-edge">
        Select a session to inspect its budget and evidence.
      </div>
    );
  }
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-border bg-card card-edge">
      <header className="border-b border-border/70 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold tracking-tightish">{session.agent}</h2>
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{session.status}</span>
              {loading ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">loading detail</span> : null}
              {session.error ? <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive">error</span> : null}
            </div>
            <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">{session.id}</div>
          </div>
          <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
            <div>{formatDate(session.updatedAt)}</div>
            <div>{formatDuration(session.durationMs)}</div>
          </div>
        </div>
      </header>
      <div className="grid grid-cols-4 gap-x-6 gap-y-3 border-b border-border/60 px-5 py-4">
        <InfoField label="Model" value={session.model} />
        <InfoField label="Client" value={session.client} />
        <InfoField label="Proxy" value={session.proxyMode} />
        <InfoField label="Turns" value={formatNumber(session.turnCount)} mono />
        <InfoField label="Total tokens" value={formatNumber(session.totalTokens)} mono accent />
        <InfoField label="Input" value={formatNumber(session.inputTokens)} mono />
        <InfoField label="Output" value={formatNumber(session.outputTokens)} mono />
        <InfoField label="Cache read" value={formatNumber(session.cacheReadTokens)} mono />
        <InfoField label="Est. cost" value={session.cost.pricingStatus === "priced" ? formatUsd(session.cost.estimatedUsd) : "unpriced"} mono accent={session.cost.pricingStatus === "priced"} />
        <InfoField label="Input cost" value={formatUsd(session.cost.inputUsd)} mono />
        <InfoField label="Cache cost" value={formatUsd(session.cost.cachedInputUsd + session.cost.cacheWriteUsd)} mono />
        <InfoField label="Output cost" value={formatUsd(session.cost.outputUsd)} mono />
      </div>
      <div className="grid gap-4 px-5 py-4">
        {session.workspace ? <InfoLine label="Workspace" value={session.workspace} mono /> : null}
        {session.cost.pricing ? (
          <InfoLine
            label="Pricing"
            value={`${session.cost.pricing.provider} ${session.cost.pricing.model} · in $${session.cost.pricing.inputPerMTok}/M · out $${session.cost.pricing.outputPerMTok}/M`}
            mono
          />
        ) : (
          <InfoLine label="Pricing" value={`No model price match for ${session.model}`} />
        )}
        <SkillActivityPanel session={session} />
        <TextBlock label="First user" text={session.firstUser || "—"} />
        <TextBlock label="Last response" text={session.lastResponse || "—"} />
        {session.error ? <TextBlock label="Error" text={session.error} destructive /> : null}
      </div>
    </div>
  );
}

function SkillActivityPanel({ session }: { session: ClaudeTapSession }) {
  const activity = session.skillActivity;
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <BookOpenCheck className="size-3.5" strokeWidth={1.8} />
          Skills
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {formatNumber(activity.loadedCount)} loaded · {formatNumber(activity.mentionedCount)} mentioned
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SkillList title="Loaded registry" skills={activity.loadedSkills} empty="No loaded skills found in trace payloads." />
        <SkillList title="Mentioned in session" skills={activity.mentionedSkills} empty="No loaded skill names appeared in request/response text." />
      </div>
    </div>
  );
}

function SkillList({ title, skills, empty }: { title: string; skills: ClaudeTapSkillSignal[]; empty: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <div className="max-h-[180px] space-y-1 overflow-auto pr-1">
        {skills.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">{empty}</div>
        ) : (
          skills.map((skill) => (
            <div key={skill.name} className="rounded-md border border-border bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[12px] font-medium">{skill.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatNumber(skill.count)}</span>
              </div>
              {skill.description ? <div className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">{skill.description}</div> : null}
              {skill.evidence[0] ? <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{skill.evidence[0]}</div> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SessionRow({ session, selected, onSelect }: { session: ClaudeTapSession; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full px-4 py-3 text-left transition-colors ${selected ? "bg-primary/8" : "hover:bg-muted/50"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">{session.firstUser || session.agent}</span>
              {session.error ? <span className="shrink-0 rounded-sm bg-destructive/10 px-1 py-0.5 font-mono text-[9px] uppercase text-destructive">error</span> : null}
            </div>
            <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
              {session.agent} · {session.model} · {session.workspace ?? session.id.slice(0, 8)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[11px] text-foreground">{formatNumber(session.totalTokens)}</div>
            <div className="mt-1 text-[10.5px] text-muted-foreground">{formatDate(session.updatedAt)}</div>
          </div>
        </div>
      </button>
    </li>
  );
}

function BudgetTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-[17px] font-semibold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function MetricPill({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-3 py-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] font-semibold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-7 w-px bg-border" />;
}

function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate ${mono ? "font-mono text-[11px]" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function InfoField({ label, value, mono = false, accent = false }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-[13px] ${mono ? "font-mono tabular-nums" : ""} ${accent ? "font-semibold text-primary" : ""}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function TextBlock({ label, text, destructive = false }: { label: string; text: string; destructive?: boolean }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`max-h-[120px] overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-[12.5px] ${destructive ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-border bg-background/60 text-foreground"}`}>
        {text}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
