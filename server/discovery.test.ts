import { describe, expect, it } from "vitest";
import { parseToolName } from "./discovery";

describe("parseToolName", () => {
  it("classifies built-in core tools", () => {
    expect(parseToolName("Bash")).toEqual({ rawName: "Bash", displayName: "Bash", group: "core" });
    expect(parseToolName("Read")).toEqual({ rawName: "Read", displayName: "Read", group: "core" });
  });

  it("classifies the Task subagent tool", () => {
    expect(parseToolName("Task").group).toBe("subagent");
  });

  it("classifies subagent_* tool variants regardless of casing", () => {
    expect(parseToolName("subagent_thinker").group).toBe("subagent");
    expect(parseToolName("Subagent_Reviewer").group).toBe("subagent");
  });

  it("splits MCP-prefixed tool names into server + tool name", () => {
    const parsed = parseToolName("mcp__chrome-devtools__click");
    expect(parsed).toEqual({
      rawName: "mcp__chrome-devtools__click",
      displayName: "chrome-devtools · click",
      group: "mcp",
      mcpServer: "chrome-devtools"
    });
  });

  it("preserves double-underscore tool names that follow the server segment", () => {
    const parsed = parseToolName("mcp__server__tool__with__underscores");
    expect(parsed.group).toBe("mcp");
    expect(parsed.mcpServer).toBe("server");
    expect(parsed.displayName).toBe("server · tool__with__underscores");
  });

  it("falls back to a server-only display when no tool segment exists", () => {
    const parsed = parseToolName("mcp__bare-server");
    expect(parsed.displayName).toBe("bare-server");
    expect(parsed.mcpServer).toBe("bare-server");
  });
});
