import React from "react";

export function TriCheckbox({ state, onChange }: { state: "all" | "some" | "none"; onChange: (checked: boolean) => void }) {
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

export function Field({
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

export function StatPill({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono text-[12px] font-medium tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

export function StatDivider() {
  return <span aria-hidden className="h-3 w-px bg-border" />;
}

export function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-border/70 pl-2">
      <div className="font-mono text-[11px] tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
