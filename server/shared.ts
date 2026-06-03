import fs from "node:fs/promises";
import path from "node:path";
import type { ContextStats } from "./types";

const CHARS_PER_TOKEN = 4;

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function safeRead(target: string): Promise<string> {
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
}

/**
 * Recursively collect files under `root` up to `depth` levels deep. Missing
 * directories and unreadable entries are skipped rather than throwing, so
 * callers can probe optional config locations safely.
 */
export async function walkFiles(root: string, depth: number, predicate?: (name: string) => boolean): Promise<string[]> {
  if (depth < 0) return [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return walkFiles(target, depth - 1, predicate);
      if (entry.isFile() && (!predicate || predicate(entry.name))) return [target];
      return [];
    })
  );
  return rows.flat();
}

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function contextForText(text: string): ContextStats {
  return {
    estimatedTokens: estimateTokens(text),
    characters: text.length,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    metric: "approx_chars_per_token",
    charsPerToken: CHARS_PER_TOKEN
  };
}

export function emptyContextStats(): ContextStats {
  return contextForText("");
}

/**
 * Pull the `description` field from a markdown file's YAML frontmatter. Used for
 * the routing descriptions skills and agents carry (the text that competes to
 * trigger them). Returns undefined when there is no frontmatter or no field.
 */
export function parseFrontmatterDescription(content: string): string | undefined {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return undefined;
  const line = frontmatter[1].match(/^description:\s*(.+)$/m);
  if (!line) return undefined;
  return line[1].trim().replace(/^["']|["']$/g, "") || undefined;
}
