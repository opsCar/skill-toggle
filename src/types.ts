export type ItemCategory = "skills" | "mcp" | "hooks" | "rules" | "agents" | "plugins" | "tools";
export type ItemSource = "claude" | "codex";

export type InventoryItem = {
  id: string;
  name: string;
  source: ItemSource;
  category: ItemCategory;
  enabled: boolean;
  kind: "file" | "directory";
  activePath: string;
  backupPath: string;
  currentPath: string;
  description?: string;
  detailAvailable: boolean;
};

export type InventoryResponse = {
  roots: Record<ItemSource, { active: string; backup: string }>;
  items: InventoryItem[];
};

export type DetailResponse = {
  id: string;
  title: string;
  path: string;
  description?: string;
  content: string;
  contentType: "markdown" | "text" | "json" | "toml" | "yaml";
};
