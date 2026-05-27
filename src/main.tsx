import React from "react";
import ReactDOM from "react-dom/client";
import { BookOpen, Boxes, Check, Code2, FileJson, FolderCog, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
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
}

interface ItemDetail extends InventoryItem {
  detail: string;
  detailType: "markdown" | "json" | "text" | "none";
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

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/inventory");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Inventory failed");
      setItems(data.items);
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

  return (
    <main className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Skill Toggle</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length} items · {enabledCount} enabled · {toolTotals.claude ?? 0} Claude Code · {toolTotals.codex ?? 0} Codex
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadItems()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
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
              <ScrollArea className="h-[calc(100vh-285px)] rounded-md border bg-card">
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
    </main>
  );
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
