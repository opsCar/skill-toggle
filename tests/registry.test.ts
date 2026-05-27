import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getItem, listItems, toggleItem } from "../server/registry";
import type { RegistryRoots } from "../server/registry-types";

let tempRoot: string | undefined;

async function makeRoots(): Promise<RegistryRoots> {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-"));
  return {
    projectRoot: path.join(tempRoot, "project"),
    homeDir: path.join(tempRoot, "home")
  };
}

afterEach(async () => {
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("registry", () => {
  it("lists skills, agents, plugins, MCP entries, hooks, and rules from Claude and Codex roots", async () => {
    const roots = await makeRoots();
    await fs.mkdir(path.join(roots.projectRoot, ".codex", "skills", "demo"), { recursive: true });
    await fs.writeFile(
      path.join(roots.projectRoot, ".codex", "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Demo skill description\n---\n# Demo\n"
    );
    await fs.mkdir(path.join(roots.homeDir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(roots.homeDir, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { jira: { command: "jira" } }, hooks: { Stop: [{ command: "echo done" }] } }, null, 2)
    );
    await fs.mkdir(path.join(roots.homeDir, ".codex"), { recursive: true });
    await fs.writeFile(path.join(roots.homeDir, ".codex", "AGENTS.md"), "# Rules\nUse local project instructions.");
    await fs.mkdir(path.join(roots.projectRoot, ".codex", "agents", "reviewer"), { recursive: true });
    await fs.writeFile(path.join(roots.projectRoot, ".codex", "agents", "reviewer", "README.md"), "# Reviewer\n");
    await fs.mkdir(path.join(roots.homeDir, ".codex", "plugins", "browser"), { recursive: true });
    await fs.writeFile(path.join(roots.homeDir, ".codex", "plugins", "browser", "README.md"), "# Browser\n");

    const items = await listItems(roots);

    expect(items.some((item) => item.category === "skill" && item.name === "demo" && item.description === "Demo skill description")).toBe(true);
    expect(items.some((item) => item.category === "agent" && item.name === "reviewer")).toBe(true);
    expect(items.some((item) => item.category === "plugin" && item.name === "browser")).toBe(true);
    expect(items.some((item) => item.category === "mcp" && item.name === "jira")).toBe(true);
    expect(items.some((item) => item.category === "hook" && item.name === "Stop")).toBe(true);
    expect(items.some((item) => item.category === "rule" && item.name === "AGENTS.md")).toBe(true);
  });

  it("loads detail content for a selected item", async () => {
    const roots = await makeRoots();
    const skillDir = path.join(roots.projectRoot, ".claude", "skills", "detail-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\ndescription: Inspect me\n---\n# Detail Skill\nReadable body.");

    const skill = (await listItems(roots)).find((item) => item.name === "detail-skill");
    expect(skill).toBeTruthy();

    const detail = await getItem(skill!.id, roots);
    expect(detail?.detail).toContain("Readable body");
  });

  it("disables and restores file-backed items through provider backup roots", async () => {
    const roots = await makeRoots();
    const skillDir = path.join(roots.projectRoot, ".codex", "skills", "toggle-me");
    const skillFile = path.join(skillDir, "SKILL.md");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(skillFile, "---\ndescription: Toggle me\n---\n# Toggle");

    const active = (await listItems(roots)).find((item) => item.name === "toggle-me");
    expect(active?.status).toBe("enabled");

    const disabled = await toggleItem(active!.id, false, roots);
    expect(disabled.status).toBe("disabled");
    await expect(fs.stat(skillDir)).rejects.toThrow();
    await expect(fs.stat(path.join(roots.homeDir, ".codex_bak", "project", "skills", "toggle-me", "SKILL.md"))).resolves.toBeTruthy();

    const restored = await toggleItem(disabled.id, true, roots);
    expect(restored.status).toBe("enabled");
    await expect(fs.stat(skillFile)).resolves.toBeTruthy();
  });
});
