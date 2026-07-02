import { expect, test } from "vitest";
import { computeApply } from "../server/profiles";
import type { Category, InventoryItem, ItemKind, Profile, ProfileEntry, ToolName } from "../server/types";

function item(id: string, enabled: boolean, opts: { kind?: ItemKind; category?: Category; tool?: ToolName } = {}): InventoryItem {
  return {
    id,
    tool: opts.tool ?? "claude",
    category: opts.category ?? "skills",
    kind: opts.kind ?? "path",
    name: id,
    enabled,
    description: "",
    source: "test",
    builtin: false,
    detailAvailable: false,
    valid: true,
    context: { estimatedTokens: 0, characters: 0, bytes: 0, lines: 0, metric: "approx_chars_per_token", charsPerToken: 4 }
  };
}

function profile(enabled: ProfileEntry[]): Profile {
  return { id: "p1", name: "Test", createdAt: "", updatedAt: "", enabled };
}

function entry(id: string): ProfileEntry {
  return { id, name: id, tool: "claude", category: "skills" };
}

test("enables whitelisted-but-off items and disables everything else that is on", () => {
  const inventory = [
    item("keep-on", true), // whitelisted + already on -> unchanged
    item("turn-on", false), // whitelisted + off -> enable
    item("turn-off", true), // not whitelisted + on -> disable
    item("stay-off", false) // not whitelisted + off -> unchanged
  ];
  const result = computeApply(profile([entry("keep-on"), entry("turn-on")]), inventory);

  expect(result.toEnable.map((c) => c.id)).toEqual(["turn-on"]);
  expect(result.toDisable.map((c) => c.id)).toEqual(["turn-off"]);
  expect(result.unchanged).toBe(2);
  expect(result.missing).toEqual([]);
  expect(result.dryRun).toBe(true);
});

test("excludes session-derived items from being governed", () => {
  const inventory = [
    item("builtin-tool", true, { kind: "session-derived", category: "tools" }),
    item("regular", true)
  ];
  // Empty whitelist would disable everything governable — but session-derived is skipped.
  const result = computeApply(profile([]), inventory);

  expect(result.toDisable.map((c) => c.id)).toEqual(["regular"]);
  expect(result.unchanged).toBe(0);
});

test("reports whitelist entries no longer present in inventory as missing", () => {
  const inventory = [item("still-here", false)];
  const result = computeApply(profile([entry("still-here"), entry("deleted-skill")]), inventory);

  expect(result.toEnable.map((c) => c.id)).toEqual(["still-here"]);
  expect(result.missing.map((e) => e.id)).toEqual(["deleted-skill"]);
});

test("no changes when inventory already matches the profile", () => {
  const inventory = [item("a", true), item("b", false)];
  const result = computeApply(profile([entry("a")]), inventory);

  expect(result.toEnable).toEqual([]);
  expect(result.toDisable).toEqual([]);
  expect(result.unchanged).toBe(2);
});
