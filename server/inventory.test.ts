import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeId, encodeId } from "./inventory";

describe("inventory id codec", () => {
  it("round trips a filesystem item identity", () => {
    const activePath = path.join("/tmp", "skill-toggle", ".codex", "skills", "demo");
    const id = encodeId("codex", "skills", activePath);
    expect(decodeId(id)).toEqual({ source: "codex", category: "skills", activePath });
  });

  it("rejects invalid ids", () => {
    expect(() => decodeId(Buffer.from(JSON.stringify({ source: "bad", category: "skills", activePath: "/tmp/a" })).toString("base64url"))).toThrow(
      /Invalid item id/
    );
  });
});
