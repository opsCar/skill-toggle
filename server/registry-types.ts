export type Provider = "claude" | "codex";
export type Category = "skill" | "mcp" | "hook" | "rule" | "agent" | "plugin" | "tool";
export type Scope = "project" | "home";
export type Status = "enabled" | "disabled";

export interface RegistryItem {
  id: string;
  provider: Provider;
  category: Category;
  scope: Scope;
  name: string;
  status: Status;
  path: string;
  originalPath: string;
  backupPath: string;
  canToggle: boolean;
  description?: string;
  detailPath?: string;
  detailPreview?: string;
}

export interface RegistryDetail extends RegistryItem {
  detail: string;
}

export interface RegistryRoots {
  projectRoot: string;
  homeDir: string;
}
