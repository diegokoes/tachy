import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  findCommand,
  commandAutoApprove,
} from "../../packages/api/src/commands";
import { buildPrompt } from "../../packages/api/src/turn-config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("slash command registry", () => {
  it("exposes the built-in workflow commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "analyze",
        "consult",
        "compact",
        "az",
        "code",
        "ingest-wiki",
        "wiki-draft",
      ]),
    );
  });

  it("compact posts by default and keeps the transcript out of the chat", () => {
    const expanded = findCommand("compact")!.expand("fd 59577");
    expect(expanded).toContain("compact_work_item");
    expect(expanded).toContain("leave post_note at its default so it posts");
    expect(expanded).toContain("--no-note");
    expect(expanded).toContain("Do NOT pass return_turns");
    expect(expanded).toMatch(/at most four lines/);
  });

  it("only /compact carries a write auto-approval", () => {
    expect(commandAutoApprove("compact")).toEqual(["compact_work_item"]);
    for (const command of BUILTIN_COMMANDS)
      if (command.name !== "compact")
        expect(commandAutoApprove(command.name)).toEqual([]);
    expect(commandAutoApprove("save_knowledge_entry")).toEqual([]);
    expect(commandAutoApprove("")).toEqual([]);
  });

  // Written by the wiki's gap list, so both arguments name themselves.
  it("wiki-draft names its arguments and falls back to the gap list", () => {
    const expanded = findCommand("wiki-draft")!.expand(
      "tpd component=printing article=spooler-stalls",
    );
    expect(expanded).toContain("list_wiki_gaps");
    expect(expanded).toContain("article=<slug>");
    expect(expanded).toContain("never from general knowledge");
    expect(expanded).toContain(
      "User arguments: tpd component=printing article=spooler-stalls",
    );
  });

  // An expansion points at a mode by name and the steps live in prompt.md.
  // Renaming a heading there would leave the command naming a mode the model
  // has never been told about.
  it("names only modes the agent prompt defines", () => {
    const prompt = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "packages/agent/prompt.md",
      ),
      "utf8",
    );
    const headings = new Set(
      [...prompt.matchAll(/^### (.+?)(?: -|$)/gm)].map((m) =>
        m[1].trim().toLowerCase(),
      ),
    );
    const named = BUILTIN_COMMANDS.flatMap((c) =>
      [...c.expand("").matchAll(/\b([A-Z][A-Z ]*[A-Z]) MODE\b/g)].map((m) =>
        m[1].toLowerCase(),
      ),
    );
    expect(named.length).toBeGreaterThan(4);
    expect(named.filter((m) => !headings.has(m))).toEqual([]);
  });

  it("/code passes the scope on and keeps it out of the question", () => {
    const scoped = findCommand("code")!.expand(
      "@portal-api @Portal-Mobile/ why does login loop?",
    );
    expect(scoped).toContain("repos portal-api; project Portal-Mobile");
    expect(scoped).toContain("`repos` / `project`");
    expect(scoped).toContain("User arguments: why does login loop?");

    const open = findCommand("code")!.expand("why does login loop?");
    expect(open).not.toContain("Scope chosen");
    expect(open).toContain("CODE CONSULTATION MODE");
  });

  // The button on a code answer sends it; nobody types it.
  it("keeps /walkthrough out of the menu and still expands it", () => {
    const walkthrough = findCommand("walkthrough")!;
    expect(walkthrough.hidden).toBe(true);
    expect(walkthrough.expand("")).toContain("show_code_walkthrough");
    expect(BUILTIN_COMMANDS.filter((c) => c.hidden).map((c) => c.name)).toEqual(
      ["walkthrough"],
    );
  });

  it("retires /create-ticket for the /az group", () => {
    expect(findCommand("create-ticket")).toBeUndefined();
    expect(findCommand("az")!.subcommands!.map((s) => s.name)).toEqual([
      "new",
      "explain",
    ]);
  });

  it("/az new is the web app's own and never becomes an agent mode", () => {
    const az = findCommand("az")!;
    expect(az.subcommands!.find((s) => s.name === "new")).toMatchObject({
      client: true,
    });
    expect(az.expand("new ProjA Bug")).toMatch(/web app/);
    expect(az.expand("new ProjA Bug")).not.toMatch(/MODE/);
  });

  it("/az explain carries its own instructions and the id", () => {
    const expanded = findCommand("az")!.expand("explain 4312");
    expect(expanded).toContain("fetch_work_item");
    expect(expanded).toContain("save nothing");
    expect(expanded).toContain("User arguments: 4312");
  });

  it("/az with an unknown subcommand lists the real ones", () => {
    expect(findCommand("az")!.expand("delete 1")).toContain("new, explain");
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

  it("buildPrompt names the reader's date format only when it is not the default", () => {
    expect(
      buildPrompt({
        message: "hi",
        dateFormat: { order: "dmy", clock: "24h" },
      }),
    ).toBe("hi");
    const prompt = buildPrompt({
      message: "hi",
      dateFormat: { order: "iso", clock: "12h" },
    });
    expect(prompt).toContain("2026-09-29 2:05 PM (UTC)");
    expect(prompt.endsWith("hi")).toBe(true);
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
