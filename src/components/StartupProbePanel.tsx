import React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiniMetric } from "@/components/primitives";
import { formatNumber, shortPrompt } from "@/lib/format";
import { TOOL_LABELS, type StartupProbe, type ToolName } from "@/types";

export function StartupProbePanel({
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
    <div className="mt-5 border-t border-border/70 pt-4">
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
        <div className="mt-3 space-y-4">
          {visibleTools.map((row) => (
            <div key={row.tool} className="border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
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
