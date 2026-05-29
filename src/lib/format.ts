import type { Category, InventoryItem, ToolName, UsageStats } from "@/types";
import { CATEGORY_ORDER } from "@/types";

export function formatProgressPercent(progress: number | null): string | null {
  if (progress == null) return null;
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

export function formatBytes(bytes: number): string {
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

const numberFormatter = new Intl.NumberFormat();
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortPrompt(value?: string): string {
  if (!value) return "unknown";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

export function usageSignal(usage?: UsageStats): string {
  if (!usage || usage.total === 0) return "none";
  const rows: Array<[string, number]> = [
    ["skill", usage.skill],
    ["mcp", usage.mcp],
    ["hook", usage.hook],
    ["tool", usage.tool],
    ["rule", usage.rule],
    ["agent", usage.agent],
    ["plugin", usage.plugin]
  ];
  return rows.reduce((best, row) => (row[1] > best[1] ? row : best))[0];
}

export function selectedState(items: InventoryItem[], selected: Set<string>): "all" | "some" | "none" {
  let on = 0;
  for (const item of items) if (selected.has(item.id)) on += 1;
  if (on === 0) return "none";
  if (on === items.length) return "all";
  return "some";
}

export function groupItems<T extends InventoryItem>(items: T[]) {
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
  return Array.from(map.keys())
    .sort()
    .map((tool) => {
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
}

export function parseJsonResponse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function requestJsonWithProgress<T = any>(
  url: string,
  {
    method,
    headers,
    body,
    onProgress
  }: {
    method: string;
    headers: Record<string, string>;
    body: XMLHttpRequestBodyInit;
    onProgress: (progress: number) => void;
  }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      onProgress(Math.min(0.95, event.loaded / event.total));
    };
    xhr.onload = () => {
      const data = parseJsonResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      reject(new Error((data as { error?: string }).error ?? "Request failed"));
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.send(body);
  });
}
