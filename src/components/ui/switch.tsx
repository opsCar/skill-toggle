import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({ checked, disabled, title, onCheckedChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        checked
          ? "border-primary/40 bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
          : "border-border bg-muted",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out",
          checked ? "translate-x-[20px]" : "translate-x-[2px]"
        )}
      />
    </button>
  );
}
