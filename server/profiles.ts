import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listInventory, performToggle } from "./discovery";
import type { InventoryItem, Profile, ProfileApplyChange, ProfileApplyResult, ProfileEntry } from "./types";

const home = os.homedir();
const storeDir = () => path.join(home, ".skill-toggle");
const profilesFile = () => path.join(storeDir(), "profiles.json");
const logFile = () => path.join(storeDir(), "profiles.log");

// Best-effort JSON-lines log for manual testing. Each call appends one line to
// ~/.skill-toggle/profiles.log; failures to write are swallowed so logging never
// breaks a profile operation. Set SKILL_TOGGLE_PROFILE_LOG=0 to disable.
async function log(event: string, data: Record<string, unknown> = {}): Promise<void> {
  if (process.env.SKILL_TOGGLE_PROFILE_LOG === "0") return;
  try {
    await fs.mkdir(storeDir(), { recursive: true });
    await fs.appendFile(logFile(), `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`);
  } catch {
    // Logging is best-effort — never let it surface as an operation error.
  }
}

/** Only path/config-entry items can be toggled; session-derived items throw in toggleItem. */
function governable(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.filter((item) => item.kind !== "session-derived");
}

function toEntry(item: InventoryItem): ProfileEntry {
  return { id: item.id, name: item.name, tool: item.tool, category: item.category };
}

function snapshotEntries(inventory: InventoryItem[]): ProfileEntry[] {
  return governable(inventory)
    .filter((item) => item.enabled)
    .map(toEntry);
}

/** Resolve an explicit id whitelist against current inventory (ignores unknown ids). */
function entriesForIds(inventory: InventoryItem[], enabledIds: string[]): ProfileEntry[] {
  const wanted = new Set(enabledIds);
  return governable(inventory)
    .filter((item) => wanted.has(item.id))
    .map(toEntry);
}

export async function listProfiles(): Promise<Profile[]> {
  try {
    const raw = await fs.readFile(profilesFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Profile[]) : [];
  } catch {
    return [];
  }
}

async function saveProfiles(profiles: Profile[]): Promise<void> {
  await fs.mkdir(storeDir(), { recursive: true });
  const tmp = `${profilesFile()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(profiles, null, 2));
  await fs.rename(tmp, profilesFile());
}

async function requireProfile(id: string): Promise<{ profiles: Profile[]; index: number }> {
  const profiles = await listProfiles();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index === -1) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });
  return { profiles, index };
}

export async function createProfile(input: { name: string; description?: string; enabledIds?: string[] }): Promise<Profile> {
  const name = input.name?.trim();
  if (!name) throw Object.assign(new Error("Profile name is required"), { statusCode: 400 });
  const inventory = await listInventory();
  const now = new Date().toISOString();
  const profile: Profile = {
    id: crypto.randomUUID(),
    name,
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    enabled: input.enabledIds ? entriesForIds(inventory, input.enabledIds) : snapshotEntries(inventory)
  };
  const profiles = await listProfiles();
  profiles.push(profile);
  await saveProfiles(profiles);
  await log("create", {
    id: profile.id,
    name: profile.name,
    mode: input.enabledIds ? "explicit-ids" : "snapshot",
    requestedIds: input.enabledIds?.length ?? null,
    enabledCount: profile.enabled.length,
    inventorySize: inventory.length
  });
  return profile;
}

export async function updateProfile(
  id: string,
  patch: { name?: string; description?: string; enabledIds?: string[] }
): Promise<Profile> {
  const { profiles, index } = await requireProfile(id);
  const current = profiles[index];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw Object.assign(new Error("Profile name cannot be empty"), { statusCode: 400 });
    current.name = name;
  }
  if (patch.description !== undefined) current.description = patch.description.trim() || undefined;
  if (patch.enabledIds !== undefined) {
    const inventory = await listInventory();
    current.enabled = entriesForIds(inventory, patch.enabledIds);
  }
  current.updatedAt = new Date().toISOString();
  await saveProfiles(profiles);
  await log("update", {
    id: current.id,
    name: current.name,
    changed: Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined),
    enabledCount: current.enabled.length
  });
  return current;
}

export async function captureProfile(id: string): Promise<Profile> {
  const { profiles, index } = await requireProfile(id);
  const inventory = await listInventory();
  profiles[index].enabled = snapshotEntries(inventory);
  profiles[index].updatedAt = new Date().toISOString();
  await saveProfiles(profiles);
  await log("capture", { id, name: profiles[index].name, enabledCount: profiles[index].enabled.length, inventorySize: inventory.length });
  return profiles[index];
}

export async function deleteProfile(id: string): Promise<void> {
  const { profiles, index } = await requireProfile(id);
  const removed = profiles[index];
  profiles.splice(index, 1);
  await saveProfiles(profiles);
  await log("delete", { id, name: removed.name });
}

/**
 * Pure diff between a profile's whitelist and the current inventory (authoritative mode):
 * whitelisted governable items should be ON, everything else governable OFF.
 */
export function computeApply(profile: Profile, inventory: InventoryItem[]): ProfileApplyResult {
  const whitelist = new Set(profile.enabled.map((entry) => entry.id));
  const toEnable: ProfileApplyChange[] = [];
  const toDisable: ProfileApplyChange[] = [];
  let unchanged = 0;

  for (const item of governable(inventory)) {
    const target = whitelist.has(item.id);
    if (item.enabled === target) {
      unchanged += 1;
      continue;
    }
    const change: ProfileApplyChange = { ...toEntry(item), action: target ? "enabled" : "disabled", ok: false };
    (target ? toEnable : toDisable).push(change);
  }

  const present = new Set(governable(inventory).map((item) => item.id));
  const missing = profile.enabled.filter((entry) => !present.has(entry.id));

  return { profileId: profile.id, toEnable, toDisable, unchanged, failures: [], missing, dryRun: true };
}

export async function applyProfile(id: string, options: { dryRun?: boolean } = {}): Promise<ProfileApplyResult> {
  const { profiles, index } = await requireProfile(id);
  const inventory = await listInventory();
  const plan = computeApply(profiles[index], inventory);
  const dryRun = Boolean(options.dryRun);
  await log(dryRun ? "apply.preview" : "apply.start", {
    id,
    name: profiles[index].name,
    inventorySize: inventory.length,
    plan: {
      toEnable: plan.toEnable.map((c) => c.name),
      toDisable: plan.toDisable.map((c) => c.name),
      unchanged: plan.unchanged,
      missing: plan.missing.map((c) => c.name)
    }
  });
  if (dryRun) return plan;

  // Reuse the single inventory scan above — toggling by id would re-scan the
  // whole tree twice per item (O(N²)); performToggle takes the item directly.
  const byId = new Map(inventory.map((item) => [item.id, item]));
  const failures: ProfileApplyChange[] = [];
  for (const change of [...plan.toEnable, ...plan.toDisable]) {
    try {
      const item = byId.get(change.id);
      if (!item) throw new Error("Item no longer present in inventory");
      await performToggle(item, change.action === "enabled");
      change.ok = true;
      await log("apply.item", { id, item: change.name, action: change.action, ok: true });
    } catch (error) {
      change.ok = false;
      change.error = error instanceof Error ? error.message : String(error);
      failures.push(change);
      await log("apply.item", { id, item: change.name, action: change.action, ok: false, error: change.error });
    }
  }
  await log("apply.done", {
    id,
    name: profiles[index].name,
    enabled: plan.toEnable.filter((c) => c.ok).length,
    disabled: plan.toDisable.filter((c) => c.ok).length,
    failures: failures.length,
    failedItems: failures.map((c) => ({ item: c.name, action: c.action, error: c.error }))
  });
  return { ...plan, failures, dryRun: false };
}
