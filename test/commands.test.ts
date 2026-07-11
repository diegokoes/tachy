import { describe, expect, it } from "vitest";
import { BUILTIN_COMMANDS, findCommand } from "../packages/api/src/commands";
import { buildPrompt } from "../packages/api/src/routes/agent";

describe("slash command registry", () => {
  it("exposes the built-in workflow commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "analyze",
        "consult",
        "create-ticket",
        "code",
        "ingest-wiki",
      ]),
    );
  });

  it("expands args into the command block", () => {
    const cmd = findCommand("analyze")!;
    expect(cmd.expand("fd 123")).toContain("User arguments: fd 123");
    expect(cmd.expand("")).toContain("(none");
  });

  it("buildPrompt prepends an authoritative <command> block", () => {
    const prompt = buildPrompt({
      message: "/analyze fd 123",
      command: { name: "analyze", args: "fd 123" },
    });
    expect(prompt.startsWith('<command name="analyze">')).toBe(true);
    expect(prompt).toContain("INGEST MODE");
    expect(prompt).toContain("authoritative mode selector");
    expect(prompt.endsWith("/analyze fd 123")).toBe(true);
  });

  it("buildPrompt rejects unknown commands", () => {
    expect(() =>
      buildPrompt({ message: "x", command: { name: "nope", args: "" } }),
    ).toThrow(/unknown command/);
  });

  it("command block precedes artifact context", () => {
    const prompt = buildPrompt({
      message: "hello",
      command: { name: "code", args: "printer" },
      artifact: { title: "T", body: "B" },
    });
    expect(prompt.indexOf("<command")).toBeLessThan(
      prompt.indexOf("<artifact"),
    );
  });
});
