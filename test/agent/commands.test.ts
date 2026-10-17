import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  findCommand,
  commandAutoApprove,
} from "../../packages/api/src/commands";
import { CHAT_MODE_LIST, findMode } from "../../packages/api/src/modes";
import { buildPrompt, turnChoice } from "../../packages/api/src/turn-config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("slash command registry", () => {
  it("keeps actions as commands and leaves modes and sources to their own", () => {
    expect(BUILTIN_COMMANDS.map((c) => c.name)).toEqual([
      "compact",
      "summary",
      "az",
      "walkthrough",
      "ingest-wiki",
      "wiki-draft",
    ]);
    expect(CHAT_MODE_LIST.map((m) => m.name)).toEqual(["analyze", "code"]);
  });

  it("compact posts by default and keeps the transcript out of the chat", () => {
    const expanded = findCommand("compact")!.expand("fd 59577");
    expect(expanded).toContain("compact_work_item");
    expect(expanded).toContain("leave post_note at its default so it posts");
    expect(expanded).toContain("--no-note");
    expect(expanded).toContain("Do NOT pass return_turns");
    expect(expanded).toMatch(/at most four lines/);
  });

  it("summary reads the thread, posts through its own tool and stays brief", () => {
    const expanded = findCommand("summary")!.expand("fd 59577");
    expect(expanded).toContain("fetch_work_item");
    expect(expanded).toContain("post_work_item_summary");
    // The files that bear on the problem are opened, and not all of them.
    expect(expanded).toContain("read_file");
    expect(expanded).toMatch(/at most five/);
    expect(expanded).toMatch(/at most two lines/);
    expect(expanded).toContain("User arguments: fd 59577");
  });

  it("only the commands that exist to post carry a write auto-approval", () => {
    expect(commandAutoApprove("compact")).toEqual(["compact_work_item"]);
    expect(commandAutoApprove("summary")).toEqual(["post_work_item_summary"]);
    for (const command of BUILTIN_COMMANDS)
      if (command.name !== "compact" && command.name !== "summary")
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
    const expansions = [...BUILTIN_COMMANDS, ...CHAT_MODE_LIST].map((c) =>
      c.expand(""),
    );
    const named = expansions.flatMap((text) =>
      [...text.matchAll(/\b([A-Z][A-Z ]*[A-Z]) MODE\b/g)].map((m) =>
        m[1].toLowerCase(),
      ),
    );
    expect(named.length).toBeGreaterThan(3);
    expect(named.filter((m) => !headings.has(m))).toEqual([]);
  });

  it("code mode shows a flow and keeps other answers short", () => {
    const expanded = findMode("code")!.expand("");
    expect(expanded).toContain("CODE CONSULTATION MODE");
    expect(expanded).toContain("call show_code_walkthrough");
    expect(expanded).toContain("at most six lines");
  });

  it("analyze mode names the ticket it was entered with, and none without", () => {
    expect(findMode("analyze")!.expand("fd 123")).toContain("Ticket: fd 123");
    expect(findMode("analyze")!.expand("")).not.toContain("Ticket");
  });

  // The button on a code answer sends it; nobody types it.
  it("keeps /walkthrough out of the menu and still expands it", () => {
    const walkthrough = findCommand("walkthrough")!;
    expect(walkthrough.hidden).toBe(true);
    expect(walkthrough.expand("")).toContain("show_code_walkthrough");
  });

  // Kept for the wiki to send; nobody picks them from the menu.
  it("hides the wiki commands without dropping them", () => {
    expect(BUILTIN_COMMANDS.filter((c) => c.hidden).map((c) => c.name)).toEqual(
      ["walkthrough", "ingest-wiki", "wiki-draft"],
    );
    expect(findCommand("ingest-wiki")!.expand("")).toContain(
      "CONTEXT DUMP MODE",
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
    const cmd = findCommand("compact")!;
    expect(cmd.expand("fd 123")).toContain("User arguments: fd 123");
    expect(cmd.expand("")).toContain("(none");
  });

  it("buildPrompt prepends an authoritative <command> block", () => {
    const prompt = buildPrompt({
      message: "/compact fd 123",
      command: { name: "compact", args: "fd 123" },
    });
    expect(prompt.startsWith('<command name="compact">')).toBe(true);
    expect(prompt).toContain("COMPACT MODE");
    expect(prompt).toContain("authoritative mode selector");
    expect(prompt.endsWith("/compact fd 123")).toBe(true);
  });

  it("buildPrompt carries the mode on every turn, ahead of a command", () => {
    const prompt = buildPrompt({
      message: "/summary fd 9",
      mode: { name: "analyze", args: "" },
      command: { name: "summary", args: "fd 9" },
    });
    expect(prompt.startsWith('<mode name="analyze">')).toBe(true);
    expect(prompt).toContain("INGEST MODE");
    expect(prompt).toContain("until they leave it");
    expect(prompt.indexOf("<mode")).toBeLessThan(prompt.indexOf("<command"));
  });

  it("buildPrompt says when the user left a mode", () => {
    const prompt = buildPrompt({ message: "hi", leftMode: "code" });
    expect(prompt).toBe(
      "The user left code mode. Route this message on what it asks.\n\nhi",
    );
  });

  it("buildPrompt rejects an unknown mode", () => {
    expect(() =>
      buildPrompt({
        message: "x",
        mode: { name: "nope" as "code", args: "" },
      }),
    ).toThrow(/unknown mode/);
  });

  it("buildPrompt lists attached sources by kind, each with where it goes", () => {
    const prompt = buildPrompt({
      message: "why?",
      mentions: [
        { kind: "bucket", key: "onboarding" },
        { kind: "repo", key: "billing-api" },
        { kind: "repo", key: "ledger" },
        { kind: "repo", key: "ledger" },
        { kind: "project", key: "Payments" },
      ],
    });
    expect(prompt).toContain(
      "repos: billing-api, ledger - pass as `repos` to search_code",
    );
    expect(prompt).toContain("projects: Payments - pass as `project`");
    expect(prompt).toContain("buckets: onboarding - search_bucket");
    expect(prompt.indexOf("repos:")).toBeLessThan(prompt.indexOf("buckets:"));
    expect(prompt.endsWith("why?")).toBe(true);
    expect(buildPrompt({ message: "hi", mentions: [] })).toBe("hi");
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
      command: { name: "compact", args: "fd 1" },
      artifact: { title: "T", body: "B" },
    });
    expect(prompt.indexOf("<command")).toBeLessThan(
      prompt.indexOf("<artifact"),
    );
  });
});

describe("a conversation's own model", () => {
  const preferred = { model: "claude-sonnet-5", effort: "medium" as const };

  it("leaves the preference alone when nothing was picked", () => {
    expect(turnChoice(preferred, {})).toEqual(preferred);
  });

  it("lays the picked model and effort over the preference", () => {
    expect(turnChoice(preferred, { model: "claude-opus-5" })).toEqual({
      model: "claude-opus-5",
      effort: "medium",
    });
    expect(
      turnChoice(preferred, { model: "claude-opus-5", effort: "max" }),
    ).toEqual({ model: "claude-opus-5", effort: "max" });
    expect(turnChoice(preferred, { effort: "low" })).toEqual({
      model: "claude-sonnet-5",
      effort: "low",
    });
  });

  // effectiveModel would run the first allowed model instead, unannounced.
  it("refuses a model the org's list does not carry", () => {
    const limited = { ...preferred, allowedModels: ["claude-sonnet-5"] };
    expect(() => turnChoice(limited, { model: "claude-opus-5" })).toThrow(
      /not on your org's list/,
    );
    expect(turnChoice(limited, { model: "claude-sonnet-5" }).model).toBe(
      "claude-sonnet-5",
    );
  });

  it("takes any model when the org keeps no list", () => {
    expect(
      turnChoice({ ...preferred, allowedModels: [] }, { model: "anything" })
        .model,
    ).toBe("anything");
  });
});
