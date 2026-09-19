import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  findCommand,
  commandAutoApprove,
} from "../packages/api/src/commands";
import { buildPrompt } from "../packages/api/src/turn-config";

describe("slash command registry", () => {
  it("exposes the built-in workflow commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "analyze",
        "consult",
        "compact",
        "create-ticket",
        "code",
        "ingest-wiki",
        "wiki-draft",
      ]),
    );
  });

  it("compact posts by default and keeps the transcript out of the chat", () => {
    const t = findCommand("compact")!.expand("fd 59577");
    expect(t).toContain("compact_work_item");
    expect(t).toContain("leave post_note at its default so it posts");
    expect(t).toContain("--no-note");
    expect(t).toContain("Do NOT pass return_turns");
    expect(t).toMatch(/at most four lines/);
  });

  it("only /compact carries a write auto-approval", () => {
    expect(commandAutoApprove("compact")).toEqual(["compact_work_item"]);
    for (const c of BUILTIN_COMMANDS)
      if (c.name !== "compact") expect(commandAutoApprove(c.name)).toEqual([]);
    expect(commandAutoApprove("save_knowledge_entry")).toEqual([]);
    expect(commandAutoApprove("")).toEqual([]);
  });

  /** Written by the wiki's gap list, so both arguments name themselves. */
  it("wiki-draft names its arguments and falls back to the gap list", () => {
    const t = findCommand("wiki-draft")!.expand(
      "tpd component=printing article=spooler-stalls",
    );
    expect(t).toContain("list_wiki_gaps");
    expect(t).toContain("article=<slug>");
    expect(t).toContain("never from general knowledge");
    expect(t).toContain(
      "User arguments: tpd component=printing article=spooler-stalls",
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
