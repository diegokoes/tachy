import { describe, expect, it } from "vitest";
import type { Mentionables } from "@tachy/contract";
import {
  mentionBeingTyped,
  mentionOptions,
  mentionWord,
  parseMentionWord,
  reposNamedIn,
  takeTypedMentions,
  withMentions,
  withoutMentionBeingTyped,
} from "../../packages/web/src/chat/mentions";

const LISTED: Mentionables = {
  repos: [
    { slug: "billing-api", product_slug: "pay", project: "Payments" },
    { slug: "docs", product_slug: null, project: null },
  ],
  buckets: [
    { slug: "onboarding", name: "Onboarding guides" },
    { slug: "docs", name: "Product docs" },
  ],
  projects: ["Payments"],
};

describe("mentionBeingTyped", () => {
  it("reads the word at the end of the line", () => {
    expect(mentionBeingTyped("what about @bill")).toEqual({
      kind: null,
      query: "bill",
    });
    expect(mentionBeingTyped("@")).toEqual({ kind: null, query: "" });
  });

  it("splits a kind prefix off", () => {
    expect(mentionBeingTyped("@bucket.onb")).toEqual({
      kind: "bucket",
      query: "onb",
    });
    expect(mentionBeingTyped("@repo.")).toEqual({ kind: "repo", query: "" });
  });

  it("keeps a dot that names no kind in the query", () => {
    expect(mentionBeingTyped("@v1.2")).toEqual({ kind: null, query: "v1.2" });
  });

  it("is null for an address or a finished word", () => {
    expect(mentionBeingTyped("mail a@b")).toBeNull();
    expect(mentionBeingTyped("@billing-api ")).toBeNull();
    expect(mentionBeingTyped("no mention")).toBeNull();
  });
});

describe("mentionOptions", () => {
  it("offers every kind for a bare word, matched on key and hint", () => {
    const keys = mentionOptions(LISTED, { kind: null, query: "doc" }).map((o) =>
      mentionWord(o.mention),
    );
    expect(keys).toEqual(["repo.docs", "bucket.docs"]);
    expect(
      mentionOptions(LISTED, { kind: null, query: "guides" }).map(
        (o) => o.mention.key,
      ),
    ).toEqual(["onboarding"]);
  });

  it("narrows to the kind typed", () => {
    expect(
      mentionOptions(LISTED, { kind: "project", query: "" }).map(
        (o) => o.mention,
      ),
    ).toEqual([{ kind: "project", key: "Payments" }]);
  });
});

describe("takeTypedMentions", () => {
  it("takes prefixed and bare words, a bare one matching every kind", () => {
    const { mentions, rest } = takeTypedMentions(
      "@repo.billing-api why does @docs say so?",
      LISTED,
    );
    expect(mentions).toEqual([
      { kind: "repo", key: "billing-api" },
      { kind: "repo", key: "docs" },
      { kind: "bucket", key: "docs" },
    ]);
    expect(rest).toBe("why does say so?");
  });

  it("keeps punctuation after a word and words that name nothing", () => {
    const { mentions, rest } = takeTypedMentions(
      "ask @onboarding, then @someone",
      LISTED,
    );
    expect(mentions).toEqual([{ kind: "bucket", key: "onboarding" }]);
    expect(rest).toBe("ask, then @someone");
  });

  it("leaves addresses alone", () => {
    expect(takeTypedMentions("mail ops@docs", LISTED).mentions).toEqual([]);
  });
});

describe("mention words", () => {
  it("round-trips a mention through its word", () => {
    expect(
      parseMentionWord(mentionWord({ kind: "bucket", key: "a.b" })),
    ).toEqual({ kind: "bucket", key: "a.b" });
    expect(parseMentionWord("docs")).toBeNull();
  });

  it("drops the word being typed", () => {
    expect(withoutMentionBeingTyped("look at @bil")).toBe("look at ");
  });

  it("adds without duplicates", () => {
    const docs = { kind: "repo" as const, key: "docs" };
    expect(
      withMentions([docs], [docs, { kind: "bucket", key: "docs" }]),
    ).toEqual([docs, { kind: "bucket", key: "docs" }]);
  });
});

describe("reposNamedIn", () => {
  const SLUGS = ["addon-acme", "addon-north", "billing-api", "ledger-service"];

  it("names a repo by a part no other repo has", () => {
    expect(reposNamedIn("what does the acme addon do?", SLUGS)).toEqual([
      "addon-acme",
    ]);
    expect(reposNamedIn("ACME: why is the arrival stuck", SLUGS)).toEqual([
      "addon-acme",
    ]);
  });

  it("names a repo by its whole slug, joined or not", () => {
    expect(reposNamedIn("see addon-acme and ledger-service.", SLUGS)).toEqual([
      "addon-acme",
      "ledger-service",
    ]);
  });

  it("does not name one by a part several repos share or a generic word", () => {
    expect(reposNamedIn("which addon handles this?", SLUGS)).toEqual([]);
    expect(reposNamedIn("the api returns 500", SLUGS)).toEqual([]);
  });

  it("ignores parts too short or numeric to name anything", () => {
    expect(reposNamedIn("ui and v2", ["ui-kit", "svc-2"])).toEqual([]);
  });

  it("leaves @ words to the typed mentions", () => {
    expect(reposNamedIn("@addon-acme what does it do", SLUGS)).toEqual([]);
    expect(reposNamedIn("@repo.addon-acme and billing", SLUGS)).toEqual([
      "billing-api",
    ]);
  });

  it("names nothing in an empty line or with no repos", () => {
    expect(reposNamedIn("", SLUGS)).toEqual([]);
    expect(reposNamedIn("the acme addon", [])).toEqual([]);
  });
});
