import React from "react";
import { ArrowLeft, Camera, Check, ChevronRight, Layers, Pencil, Play, Plus, Search, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TriCheckbox } from "@/components/primitives";
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOL_LABELS, type AiProfileResult, type Category, type InventoryItem, type Profile, type ProfileApplyResult } from "@/types";

function formatStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type View = "list" | "editor" | "apply" | "ai";

export function ProfilesDialog({
  items,
  onClose,
  onApplied
}: {
  items: InventoryItem[];
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const [profiles, setProfiles] = React.useState<Profile[]>([]);
  const [view, setView] = React.useState<View>("list");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  // Editor state (shared by create + edit).
  const [editing, setEditing] = React.useState<Profile | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Apply state.
  const [applyTarget, setApplyTarget] = React.useState<Profile | null>(null);
  const [plan, setPlan] = React.useState<ProfileApplyResult | null>(null);
  const [applied, setApplied] = React.useState<ProfileApplyResult | null>(null);

  // AI create state.
  const [aiUrl, setAiUrl] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiResult, setAiResult] = React.useState<AiProfileResult | null>(null);
  const [aiCap, setAiCap] = React.useState<{ available: boolean; reason?: string } | null>(null);

  // Only path/config-entry items are governable by a profile; session-derived
  // (built-in tools, MCP-provided tools) cannot be toggled.
  const governable = React.useMemo(() => items.filter((item) => item.kind !== "session-derived"), [items]);
  const enabledIds = React.useMemo(() => governable.filter((item) => item.enabled).map((item) => item.id), [governable]);

  // A profile matches the current environment when applying it would change
  // nothing: its enabled set (restricted to items still present) equals the set
  // of items on now. Everything else governable is off in both.
  const currentProfileIds = React.useMemo(() => {
    const governableIds = new Set(governable.map((item) => item.id));
    const enabledSet = new Set(enabledIds);
    const matches = new Set<string>();
    for (const profile of profiles) {
      const target = profile.enabled.map((entry) => entry.id).filter((id) => governableIds.has(id));
      if (target.length === enabledSet.size && target.every((id) => enabledSet.has(id))) {
        matches.add(profile.id);
      }
    }
    return matches;
  }, [profiles, governable, enabledIds]);

  const loadProfiles = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch("/api/profiles").then((r) => r.json());
      setProfiles(data.profiles ?? []);
    } catch {
      setError("Could not load profiles.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/ai-profile/capabilities")
      .then((r) => r.json())
      .then((data) => {
        if (alive) setAiCap(data);
      })
      .catch(() => {
        if (alive) setAiCap({ available: false, reason: "Could not check availability." });
      });
    return () => {
      alive = false;
    };
  }, []);

  function openAiCreate() {
    setAiUrl("");
    setAiResult(null);
    setError("");
    setView("ai");
  }

  async function generateAiProfile() {
    const url = aiUrl.trim();
    if (!url) {
      setError("Paste a GitHub repository URL.");
      return;
    }
    setAiBusy(true);
    setAiResult(null);
    setError("");
    try {
      const response = await fetch("/api/profiles/from-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Generation failed");
      const result: AiProfileResult = data.result;
      setAiResult(result);
      await loadProfiles();
      onApplied(
        `Created “${result.profile.name}” — ${result.installed.length} installed, ${result.alreadyPresent.length} already present.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiBusy(false);
    }
  }

  function openCreate() {
    // New profile starts as a snapshot of the current enabled set — save as-is
    // to snapshot, or tweak the checkboxes to hand-pick.
    setEditing(null);
    setName("");
    setDescription("");
    setSelectedIds(new Set(enabledIds));
    setError("");
    setView("editor");
  }

  function openEdit(profile: Profile) {
    setEditing(profile);
    setName(profile.name);
    setDescription(profile.description ?? "");
    setSelectedIds(new Set(profile.enabled.map((entry) => entry.id)));
    setError("");
    setView("editor");
  }

  async function saveProfile() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the profile a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ name: trimmed, description, enabledIds: [...selectedIds] });
      const url = editing ? `/api/profiles/${editing.id}` : "/api/profiles";
      const response = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed");
      await loadProfiles();
      setView("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function captureCurrent(profile: Profile) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/profiles/${profile.id}/capture`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Capture failed");
      await loadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile: Profile) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Delete failed");
      await loadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function startApply(profile: Profile) {
    setApplyTarget(profile);
    setPlan(null);
    setApplied(null);
    setError("");
    setView("apply");
    setBusy(true);
    try {
      const response = await fetch(`/api/profiles/${profile.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Preview failed");
      setPlan(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmApply() {
    if (!applyTarget) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/profiles/${applyTarget.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Apply failed");
      const result: ProfileApplyResult = data.result;
      setApplied(result);
      const okEnabled = result.toEnable.filter((c) => c.ok).length;
      const okDisabled = result.toDisable.filter((c) => c.ok).length;
      const failed = result.failures.length;
      onApplied(
        `Applied “${applyTarget.name}” — ${okEnabled} enabled, ${okDisabled} disabled${failed ? `, ${failed} failed` : ""}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }

  const headerTitle =
    view === "editor"
      ? editing
        ? "Edit profile"
        : "New profile"
      : view === "apply"
        ? "Apply profile"
        : view === "ai"
          ? "Create with AI"
          : "Profiles";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex h-[min(86vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl card-edge">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {view !== "list" ? (
              <button
                type="button"
                onClick={() => {
                  setView("list");
                  setError("");
                }}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors press hover:bg-muted hover:text-foreground"
                aria-label="Back to profiles"
              >
                <ArrowLeft className="size-4" strokeWidth={1.75} />
              </button>
            ) : (
              <Layers className="size-4 text-muted-foreground" strokeWidth={1.75} />
            )}
            <div>
              <h2 className="text-[15px] font-semibold tracking-tightish">{headerTitle}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Named on/off sets. Applying one turns its items on and everything else off.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {view === "list" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openAiCreate}
                  disabled={loading || aiCap?.available === false}
                  title={aiCap?.available === false ? aiCap.reason : undefined}
                >
                  <Sparkles className="size-3.5" strokeWidth={2} />
                  Create with AI
                </Button>
                <Button size="sm" variant="primary" onClick={openCreate} disabled={loading}>
                  <Plus className="size-3.5" strokeWidth={2} />
                  New profile
                </Button>
              </>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {error ? <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-[12px] text-destructive">{error}</div> : null}

        {view === "ai" ? (
          <AiCreateView
            url={aiUrl}
            busy={aiBusy}
            result={aiResult}
            capReason={aiCap?.available === false ? aiCap.reason : undefined}
            onUrl={setAiUrl}
            onGenerate={() => void generateAiProfile()}
            onDone={() => setView("list")}
          />
        ) : view === "editor" ? (
          <ProfileEditor
            governable={governable}
            name={name}
            description={description}
            selectedIds={selectedIds}
            busy={busy}
            onName={setName}
            onDescription={setDescription}
            onSelectedIds={setSelectedIds}
            onSnapshot={() => setSelectedIds(new Set(enabledIds))}
            onSave={() => void saveProfile()}
          />
        ) : view === "apply" && applyTarget ? (
          <ApplyView
            profile={applyTarget}
            plan={plan}
            applied={applied}
            busy={busy}
            onConfirm={() => void confirmApply()}
            onDone={() => {
              setView("list");
            }}
          />
        ) : (
          <ProfileList
            profiles={profiles}
            loading={loading}
            busy={busy}
            enabledCount={enabledIds.length}
            currentProfileIds={currentProfileIds}
            onApply={(p) => void startApply(p)}
            onEdit={openEdit}
            onCapture={(p) => void captureCurrent(p)}
            onDelete={(p) => void removeProfile(p)}
          />
        )}
      </div>
    </div>
  );
}

function ProfileList({
  profiles,
  loading,
  busy,
  enabledCount,
  currentProfileIds,
  onApply,
  onEdit,
  onCapture,
  onDelete
}: {
  profiles: Profile[];
  loading: boolean;
  busy: boolean;
  enabledCount: number;
  currentProfileIds: Set<string>;
  onApply: (profile: Profile) => void;
  onEdit: (profile: Profile) => void;
  onCapture: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (profiles.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Layers className="size-5" strokeWidth={1.5} />
        </div>
        <div className="text-[13px] font-medium">No profiles yet</div>
        <div className="mt-1 max-w-[38ch] text-[12px] text-muted-foreground">
          Create one to snapshot the {enabledCount} items you have on now — then switch setups in one click.
        </div>
      </div>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="divide-y divide-border/70">
        {profiles.map((profile) => {
          const isCurrent = currentProfileIds.has(profile.id);
          return (
          <li
            key={profile.id}
            className={`flex items-center gap-3 px-5 py-3.5 ${isCurrent ? "border-l-2 border-l-primary bg-primary/5" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium tracking-tightish">{profile.name}</span>
                {isCurrent ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-primary">
                    <Check className="size-3" strokeWidth={2.5} />
                    Current
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {profile.enabled.length} on · updated {formatStamp(profile.updatedAt)}
              </div>
              {profile.description ? <div className="mt-1 text-[12px] text-muted-foreground">{profile.description}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onApply(profile)} className="h-8 px-2.5">
                <Play className="size-3.5" strokeWidth={2} />
                Apply
              </Button>
              <IconButton label="Update to current state" disabled={busy} onClick={() => onCapture(profile)}>
                <Camera className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton label="Edit profile" disabled={busy} onClick={() => onEdit(profile)}>
                <Pencil className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton label="Delete profile" disabled={busy} onClick={() => onDelete(profile)}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            </div>
          </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors press hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ProfileEditor({
  governable,
  name,
  description,
  selectedIds,
  busy,
  onName,
  onDescription,
  onSelectedIds,
  onSnapshot,
  onSave
}: {
  governable: InventoryItem[];
  name: string;
  description: string;
  selectedIds: Set<string>;
  busy: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onSelectedIds: (next: Set<string>) => void;
  onSnapshot: () => void;
  onSave: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<Category>>(new Set());
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return governable;
    return governable.filter(
      (item) => item.name.toLowerCase().includes(needle) || CATEGORY_LABELS[item.category].toLowerCase().includes(needle)
    );
  }, [governable, query]);

  // Bucket the (filtered) items by category, honoring the canonical display order
  // and dropping categories that have no items to show.
  const groups = React.useMemo(() => {
    const byCategory = new Map<Category, InventoryItem[]>();
    for (const item of filtered) {
      const list = byCategory.get(item.category);
      if (list) list.push(item);
      else byCategory.set(item.category, [item]);
    }
    return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      items: byCategory.get(category)!
    }));
  }, [filtered]);

  // While searching, force every matching group open so results are never hidden
  // behind a collapsed header.
  const searching = query.trim().length > 0;

  function setOne(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectedIds(next);
  }

  function setMany(ids: string[], checked: boolean) {
    const next = new Set(selectedIds);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onSelectedIds(next);
  }

  function toggleCollapse(category: Category) {
    const next = new Set(collapsed);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    setCollapsed(next);
  }

  function selectionState(ids: string[]): "all" | "some" | "none" {
    const selected = ids.filter((id) => selectedIds.has(id)).length;
    return selected === 0 ? "none" : selected === ids.length ? "all" : "some";
  }

  const filteredIds = filtered.map((item) => item.id);
  const allState = selectionState(filteredIds);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 border-b border-border/70 px-5 py-4">
        <input
          aria-label="Profile name"
          className="h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none transition-colors focus:border-foreground/30 focus:ring-2 focus:ring-ring/20"
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="Profile name (e.g. Minimal coding)"
        />
        <input
          aria-label="Profile description"
          className="h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none transition-colors focus:border-foreground/30 focus:ring-2 focus:ring-ring/20"
          value={description}
          onChange={(event) => onDescription(event.target.value)}
          placeholder="Description (optional)"
        />
      </div>
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-2.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 transition-colors focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            aria-label="Search items"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/60"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search items…"
          />
        </label>
        <Button size="sm" variant="outline" disabled={busy} onClick={onSnapshot} className="h-8 px-2.5">
          <Camera className="size-3.5" strokeWidth={1.75} />
          Snapshot current
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/25 px-5 py-2">
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <TriCheckbox state={allState} onChange={(checked) => setMany(filteredIds, checked)} />
          <span>Select all shown</span>
        </label>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">{selectedIds.size} selected</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {groups.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">No items match “{query}”.</div>
        ) : (
          <div className="divide-y divide-border/70">
            {groups.map(({ category, items }) => {
              const ids = items.map((item) => item.id);
              const groupState = selectionState(ids);
              const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
              const open = searching || !collapsed.has(category);
              return (
                <section key={category}>
                  <div className="sticky top-0 z-10 flex items-center gap-2.5 bg-muted/40 px-5 py-2 backdrop-blur-sm">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(category)}
                      disabled={searching}
                      className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors press hover:text-foreground disabled:opacity-40"
                      aria-label={open ? `Collapse ${CATEGORY_LABELS[category]}` : `Expand ${CATEGORY_LABELS[category]}`}
                      aria-expanded={open}
                    >
                      <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2} />
                    </button>
                    <TriCheckbox state={groupState} onChange={(checked) => setMany(ids, checked)} />
                    <button
                      type="button"
                      onClick={() => toggleCollapse(category)}
                      disabled={searching}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="text-[12px] font-semibold tracking-tightish">{CATEGORY_LABELS[category]}</span>
                      <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                        {selectedCount}/{items.length}
                      </span>
                    </button>
                  </div>
                  {open ? (
                    <ul className="divide-y divide-border/60">
                      {items.map((item) => (
                        <li key={item.id} className="flex items-center gap-2.5 py-2 pl-[52px] pr-5">
                          <TriCheckbox state={selectedIds.has(item.id) ? "all" : "none"} onChange={(checked) => setOne(item.id, checked)} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium">{item.name}</div>
                            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                              {TOOL_LABELS[item.tool]}
                              {item.enabled ? " · on" : ""}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </ScrollArea>
      <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
        <Button variant="primary" disabled={busy} onClick={onSave}>
          <Check className="size-3.5" strokeWidth={2} />
          Save profile
        </Button>
      </div>
    </div>
  );
}

function ApplyView({
  profile,
  plan,
  applied,
  busy,
  onConfirm,
  onDone
}: {
  profile: Profile;
  plan: ProfileApplyResult | null;
  applied: ProfileApplyResult | null;
  busy: boolean;
  onConfirm: () => void;
  onDone: () => void;
}) {
  const result = applied ?? plan;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-4">
          <div className="mb-4 text-[12.5px] text-muted-foreground">
            {applied ? "Applied" : "Preview for"} <span className="font-medium text-foreground">{profile.name}</span> — authoritative mode: listed items go on, everything else goes off.
          </div>

          {!result ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <SummaryTile label={applied ? "Enabled" : "To enable"} value={result.toEnable.length} tone="primary" />
                <SummaryTile label={applied ? "Disabled" : "To disable"} value={result.toDisable.length} tone="warn" />
                <SummaryTile label="Unchanged" value={result.unchanged} tone="muted" />
              </div>

              {result.failures.length > 0 ? (
                <ChangeGroup title={`Failed (${result.failures.length})`} tone="warn">
                  {result.failures.map((c) => (
                    <ChangeRow key={c.id} name={c.name} tool={c.tool} category={c.category} note={c.error ?? "failed"} />
                  ))}
                </ChangeGroup>
              ) : null}

              {result.toDisable.length > 0 ? (
                <ChangeGroup title={`${applied ? "Disabled" : "Will disable"} (${result.toDisable.length})`} tone="warn">
                  {result.toDisable.map((c) => (
                    <ChangeRow key={c.id} name={c.name} tool={c.tool} category={c.category} note={applied ? (c.ok ? "off" : "failed") : undefined} />
                  ))}
                </ChangeGroup>
              ) : null}

              {result.toEnable.length > 0 ? (
                <ChangeGroup title={`${applied ? "Enabled" : "Will enable"} (${result.toEnable.length})`} tone="primary">
                  {result.toEnable.map((c) => (
                    <ChangeRow key={c.id} name={c.name} tool={c.tool} category={c.category} note={applied ? (c.ok ? "on" : "failed") : undefined} />
                  ))}
                </ChangeGroup>
              ) : null}

              {result.missing.length > 0 ? (
                <ChangeGroup title={`Missing from inventory (${result.missing.length})`} tone="muted">
                  {result.missing.map((c) => (
                    <ChangeRow key={c.id} name={c.name} tool={c.tool} category={c.category} note="no longer present" />
                  ))}
                </ChangeGroup>
              ) : null}

              {result.toEnable.length === 0 && result.toDisable.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                  <Check className="size-4 text-primary" strokeWidth={2} />
                  Already matches this profile — nothing to change.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
        {applied ? (
          <Button variant="primary" onClick={onDone}>
            <Check className="size-3.5" strokeWidth={2} />
            Done
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy || !plan || (plan.toEnable.length === 0 && plan.toDisable.length === 0)}
            onClick={onConfirm}
          >
            <Play className="size-3.5" strokeWidth={2} />
            {busy ? "Applying…" : "Confirm & apply"}
          </Button>
        )}
      </div>
    </div>
  );
}

function AiCreateView({
  url,
  busy,
  result,
  capReason,
  onUrl,
  onGenerate,
  onDone
}: {
  url: string;
  busy: boolean;
  result: AiProfileResult | null;
  capReason?: string;
  onUrl: (value: string) => void;
  onGenerate: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-border/70 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Paste a GitHub repo that contains skills. The assistant clones it, installs any skills you don’t already have, and
          creates a profile that turns on exactly those skills — leaving the rest of your harness as it is now.
        </p>
        <div className="flex items-center gap-2">
          <input
            aria-label="GitHub repository URL"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] outline-none transition-colors focus:border-foreground/30 focus:ring-2 focus:ring-ring/20"
            value={url}
            onChange={(event) => onUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && url.trim() && !busy) onGenerate();
            }}
            placeholder="https://github.com/mattpocock/skills"
            disabled={busy}
          />
          <Button variant="primary" disabled={busy || !url.trim()} onClick={onGenerate}>
            <Sparkles className="size-3.5" strokeWidth={2} />
            {busy ? "Working…" : "Generate"}
          </Button>
        </div>
        {capReason ? <p className="text-[11px] text-amber-600 dark:text-amber-400">{capReason}</p> : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-4">
          {busy ? (
            <div className="space-y-3">
              <div className="text-[12.5px] text-muted-foreground">Cloning the repo and installing skills — this can take a minute…</div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[12.5px]">
                <Check className="size-4 shrink-0 text-primary" strokeWidth={2} />
                <span>
                  Created profile <span className="font-medium">{result.profile.name}</span> — {result.profile.enabled.length} items on.
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SummaryTile label="Skills found" value={result.skills.length} tone="muted" />
                <SummaryTile label="Installed" value={result.installed.length} tone="primary" />
                <SummaryTile label="Already had" value={result.alreadyPresent.length} tone="muted" />
              </div>
              {result.installed.length > 0 ? <SkillChips title="Installed" names={result.installed} /> : null}
              {result.alreadyPresent.length > 0 ? <SkillChips title="Already present" names={result.alreadyPresent} /> : null}
              {result.warnings.length > 0 ? (
                <div className="space-y-1.5">
                  {result.warnings.map((warning, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-700 dark:text-amber-300"
                    >
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Sparkles className="size-5" strokeWidth={1.5} />
              </div>
              <div className="text-[13px] font-medium">Turn a skills repo into a profile</div>
              <div className="mt-1 max-w-[42ch] text-[12px] text-muted-foreground">
                Missing skills are installed for Claude, Codex, and Agents; your MCP, hooks, rules, and other harness stay untouched.
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      {result ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
          <Button variant="primary" onClick={onDone}>
            <Check className="size-3.5" strokeWidth={2} />
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SkillChips({ title, names }: { title: string; names: string[] }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <span key={name} className="rounded-md border border-border bg-card px-2 py-1 text-[11.5px] font-medium">
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "primary" | "warn" | "muted" }) {
  const toneClass =
    tone === "primary" ? "text-primary" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5 text-center card-edge">
      <div className={`text-[18px] font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">{label}</div>
    </div>
  );
}

function ChangeGroup({ title, tone, children }: { title: string; tone: "primary" | "warn" | "muted"; children: React.ReactNode }) {
  const dot = tone === "primary" ? "bg-primary" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/50";
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        {tone === "warn" ? <TriangleAlert className="size-3.5 text-amber-500" strokeWidth={1.75} /> : <span className={`size-2 rounded-full ${dot}`} />}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ChangeRow({ name, tool, category, note }: { name: string; tool: InventoryItem["tool"]; category: InventoryItem["category"]; note?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{name}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {TOOL_LABELS[tool]} · {CATEGORY_LABELS[category]}
        </div>
      </div>
      {note ? <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">{note}</span> : null}
    </div>
  );
}
