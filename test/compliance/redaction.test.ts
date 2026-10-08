import { describe, expect, it } from "vitest";

process.env.FRESHDESK_TOKEN = "test-token";
process.env.GITHUB_TOKEN = "test-token";

import {
  TokenMap,
  scrubText,
  scrubKnownNames,
  scrubDeep,
  redactNormalized,
  redactForLlm,
  resolveRedactionPolicy,
  globalRedactionEnabled,
} from "@tachy/core/compliance";
import { estimateCostUsd } from "@tachy/core/analytics";
import { type RawWorkItem } from "@tachy/core/sources";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

describe("scrubText", () => {
  it("tokenizes emails and phones with stable, repeated tokens", () => {
    const map = new TokenMap();
    const scrubbed = scrubText(
      "reach me at a@b.com or a@b.com, call +1 (555) 123-4567",
      map,
    );
    expect(scrubbed).toBe("reach me at [EMAIL_1] or [EMAIL_1], call [PHONE_1]");
  });

  it("keeps bare digit groups, which in a ticket are identifiers not phones", () => {
    const map = new TokenMap();
    const scrubbed = scrubText("UID 040 5900 1234 failed to lock", map);
    expect(scrubbed).toBe("UID 040 5900 1234 failed to lock");
  });

  it("still takes a bare group when a word announces it as a phone", () => {
    const map = new TokenMap();
    expect(scrubText("Tel: 040 5900 1234", map)).toBe("Tel: [PHONE_1]");
    expect(scrubText("móvil 629 563 807", new TokenMap())).toBe(
      "móvil [PHONE_1]",
    );
  });

  it("takes an international number with no announcing word", () => {
    const map = new TokenMap();
    expect(scrubText("signature line +34 629 56 38 07 here", map)).toBe(
      "signature line [PHONE_1] here",
    );
  });

  it("does not mangle ISO dates or short status codes", () => {
    const map = new TokenMap();
    const scrubbed = scrubText(
      "created 2015-08-24, error HTTP 503 seen on 2026-01-02",
      map,
    );
    expect(scrubbed).toBe(
      "created 2015-08-24, error HTTP 503 seen on 2026-01-02",
    );
  });

  it("tokenizes credential assignments but keeps the key as a searchable signal", () => {
    const map = new TokenMap();
    const scrubbed = scrubText(
      'set password=hunter2 and api_key: "abc-123" in the config',
      map,
    );
    expect(scrubbed).toBe(
      "set password=[SECRET_1] and api_key: [SECRET_2] in the config",
    );
  });

  it("tokenizes what follows an auth scheme, not the scheme", () => {
    const basic = "OmNhbmFyeTBwYXQxdmFsdWUydGhhdDNtdXN0NG5vdDVsZWFr";
    const header = scrubText(
      `http.extraHeader=Authorization: Basic ${basic}`,
      new TokenMap(),
    );
    expect(header).toBe("http.extraHeader=Authorization: Basic [SECRET_1]");
    expect(scrubText(`sent Basic ${basic} upstream`, new TokenMap())).toBe(
      "sent Basic [SECRET_1] upstream",
    );
    expect(
      scrubText("Authorization: Token abcDEF123456xyz", new TokenMap()),
    ).toBe("Authorization: Token [SECRET_1]");
    expect(scrubText("a basic misunderstanding of it", new TokenMap())).toBe(
      "a basic misunderstanding of it",
    );
  });

  it("tokenizes bearer tokens, known key shapes, and JWTs", () => {
    const map = new TokenMap();
    expect(scrubText("Authorization: Bearer abcDEF123456xyz", map)).toMatch(
      /Bearer \[SECRET_\d+\]/,
    );
    expect(scrubText("aws AKIAIOSFODNN7EXAMPLE leaked", map)).toBe(
      "aws [SECRET_2] leaked",
    );
    expect(
      scrubText("pat ghp_abcdefghijklmnopqrstuvwxyz012345 in logs", map),
    ).toMatch(/pat \[SECRET_\d+\] in logs/);
    expect(scrubText("key sk-abc123def456ghi789jkl012 set", map)).toMatch(
      /key \[SECRET_\d+\] set/,
    );
    expect(
      scrubText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dQw4w9WgXcQ", map),
    ).toMatch(/jwt \[SECRET_\d+\]/);
  });

  it("tokenizes PEM private key blocks", () => {
    const map = new TokenMap();
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----";
    expect(scrubText(`attached: ${pem} done`, map)).toBe(
      "attached: [SECRET_1] done",
    );
  });

  it("tokenizes Luhn-valid card numbers but keeps long non-card IDs", () => {
    const map = new TokenMap();
    expect(scrubText("card 4111 1111 1111 1111 charged", map)).toBe(
      "card [CARD_1] charged",
    );

    expect(scrubText("ref 4111 1111 1111 1112 in DevOps", map)).toBe(
      "ref 4111 1111 1111 1112 in DevOps",
    );
  });
});

describe("scrubKnownNames", () => {
  it("tokenizes declared names case-insensitively at word boundaries only", () => {
    const map = new TokenMap();
    const scrubbed = scrubKnownNames(
      "Hi, this is jane doe. The Announcement is by Ann.",
      ["Jane Doe", "Ann"],
      map,
    );
    expect(scrubbed).toBe(
      "Hi, this is [USER_1]. The Announcement is by [USER_2].",
    );
  });

  it("skips empty and too-short names", () => {
    const map = new TokenMap();
    expect(
      scrubKnownNames(
        "42 is the answer by Al",
        ["42", "Al", null, undefined],
        map,
      ),
    ).toBe("42 is the answer by Al");
  });

  it("matches a first name alone, on the full name's token", () => {
    const map = new TokenMap();
    expect(
      scrubKnownNames("Hola Javier, ping Javier Banos.", ["Javier Banos"], map),
    ).toBe("Hola [USER_1], ping [USER_1].");
  });

  it("gives an adjacent run of parts one token, not one each", () => {
    const map = new TokenMap();
    expect(
      scrubKnownNames("thanks Javier Banos for the fix", ["Javier Banos"], map),
    ).toBe("thanks [USER_1] for the fix");
  });

  it("matches across whatever whitespace each side happens to use", () => {
    const map = new TokenMap();
    expect(
      scrubKnownNames("from Javier  Banos today", ["Javier\n Banos"], map),
    ).toBe("from [USER_1] today");
  });

  it("bounds accented names correctly", () => {
    const map = new TokenMap();
    expect(scrubKnownNames("Hola José, ¿todo bien?", ["José Pérez"], map)).toBe(
      "Hola [USER_1], ¿todo bien?",
    );
  });

  it("leaves short parts alone so ordinary words survive", () => {
    const map = new TokenMap();
    expect(scrubKnownNames("an ave flew by", ["Ave Andersen"], map)).toBe(
      "an ave flew by",
    );
  });
});

describe("scrubDeep", () => {
  it("scrubs nested strings, preserves structure, and passes Dates through", () => {
    const map = new TokenMap();
    const created = new Date("2026-01-01T00:00:00Z");
    const row = {
      issue_summary: "mail ops@acme.com",
      signals: ["token=abc123secret", "HTTP 503"],
      version: 3,
      created_at: created,
      structured: { conversation_summary: "call from ops@acme.com" },
    };
    const scrubbed = scrubDeep(row, map);
    expect(scrubbed.issue_summary).toBe("mail [EMAIL_1]");
    expect(scrubbed.signals[0]).toBe("token=[SECRET_1]");
    expect(scrubbed.signals[1]).toBe("HTTP 503");
    expect(scrubbed.version).toBe(3);
    expect(scrubbed.created_at).toBe(created);
    expect(scrubbed.structured.conversation_summary).toBe(
      "call from [EMAIL_1]",
    );
    expect(row.issue_summary).toBe("mail ops@acme.com");
  });
});

describe("redactNormalized", () => {
  const base: RawWorkItem = {
    externalId: "1",
    kind: "ticket",
    title: "email jane@acme.com about login",
    requester: "42",
    requesterEmail: "jane@acme.com",
    raw: { keep: "me" },
    messages: [
      {
        visibility: "public",
        direction: "incoming",
        bodyText: "hi from jane@acme.com",
        author: "42",
      },
    ],
  };

  it("slugs the requester, drops the email, scrubs text, tokenizes authors", () => {
    const map = new TokenMap();
    const redacted = redactNormalized(base, { customerSlug: "acme-corp", map });
    expect(redacted.requester).toBe("acme-corp");
    expect(redacted.requesterEmail).toBeUndefined();
    expect(redacted.title).toBe("email [EMAIL_1] about login");
    expect(redacted.messages[0].bodyText).toBe("hi from [EMAIL_1]");
    expect(redacted.messages[0].author).toBe("[USER_1]");
  });

  it("falls back to [CUSTOMER] with no slug and never mutates the input", () => {
    const snapshot = structuredClone(base);
    const redacted = redactNormalized(base, {
      customerSlug: null,
      map: new TokenMap(),
    });
    expect(redacted.requester).toBe("[CUSTOMER]");
    expect(base).toEqual(snapshot);
  });
});

describe("freshdesk redactRaw", () => {
  const redact = createFreshdeskSource({
    baseUrl: "https://x.freshdesk.com",
    slug: "fd",
    config: {},
  }).redactRaw!;

  it("scrubs the ticket payload but keeps custom-field keys and unrelated data", () => {
    const raw = {
      id: 20,
      subject: "help",
      email: "jane@acme.com",
      name: "Jane Doe",
      phone: "+1 555 123 4567",
      cc_emails: ["cc@acme.com"],
      to_emails: ["support@vendor.com"],
      fwd_emails: [],
      twitter_id: "janed",
      description_text: "reach me at jane@acme.com",
      requester: {
        id: 42,
        email: "jane@acme.com",
        mobile: "+1 555 987 6543",
        name: "Jane Doe",
      },
      custom_fields: {
        cf_devops_work_item: "DevOps#158327",
        cf_note: "ping ops@acme.com",
      },
      status: 2,
    };
    const snapshot = structuredClone(raw);
    const redacted = redact(raw, new TokenMap(), "acme-corp") as any;

    expect(redacted.email).toMatch(/^\[EMAIL_\d+\]$/);
    expect(redacted.name).toBe("acme-corp");
    expect(redacted.phone).toMatch(/^\[PHONE_\d+\]$/);
    expect(redacted.cc_emails[0]).toMatch(/^\[EMAIL_\d+\]$/);
    expect(redacted.to_emails[0]).toMatch(/^\[EMAIL_\d+\]$/);
    expect(redacted.twitter_id).toMatch(/^\[HANDLE_\d+\]$/);
    expect(redacted.description_text).toBe("reach me at [EMAIL_1]");
    expect(redacted.requester.name).toBe("acme-corp");
    expect(redacted.requester.email).toMatch(/^\[EMAIL_\d+\]$/);
    expect(redacted.custom_fields.cf_devops_work_item).toBe("DevOps#158327");
    expect(redacted.custom_fields.cf_note).toMatch(/^ping \[EMAIL_\d+\]$/);
    expect(redacted.status).toBe(2);
    expect(raw).toEqual(snapshot);
  });
});

describe("github redactRaw", () => {
  const redact = createGithubSource({
    baseUrl: "",
    slug: "gh",
    config: { repos: ["o/r"] },
  }).redactRaw!;

  it("tokenizes actor handles/emails and scrubs body", () => {
    const raw = {
      number: 5,
      title: "bug from alice@corp.com",
      body: "email alice@corp.com",
      user: { login: "alice", email: "alice@corp.com" },
    };
    const redacted = redact(raw, new TokenMap(), null) as any;
    expect(redacted.user.login).toMatch(/^\[USER_\d+\]$/);
    expect(redacted.user.email).toMatch(/^\[EMAIL_\d+\]$/);
    expect(redacted.body).toBe("email [EMAIL_1]");
  });
});

describe("redactForLlm", () => {
  it("redacts normalized fields and the source raw with one consistent token map", () => {
    const redactRaw = createFreshdeskSource({
      baseUrl: "https://x.freshdesk.com",
      slug: "fd",
      config: {},
    }).redactRaw!;
    const item: RawWorkItem = {
      externalId: "20",
      kind: "ticket",
      title: "login help",
      requester: "42",
      requesterEmail: "jane@acme.com",
      raw: { id: 20, email: "jane@acme.com", name: "Jane Doe" },
      messages: [
        {
          visibility: "public",
          direction: "incoming",
          bodyText: "hi",
          author: "42",
        },
      ],
    };
    const redacted = redactForLlm(item, redactRaw, "acme-corp");
    expect(redacted.requester).toBe("acme-corp");
    expect(redacted.requesterEmail).toBeUndefined();
    expect((redacted.raw as any).email).toMatch(/^\[EMAIL_\d+\]$/);
    expect((redacted.raw as any).name).toBe("acme-corp");
  });

  it("drops the raw payload when the source has no redactRaw hook", () => {
    const item: RawWorkItem = {
      externalId: "1",
      kind: "ticket",
      requester: "u",
      raw: { secret: "pii" },
      messages: [],
    };
    const redacted = redactForLlm(item, undefined, null);
    expect(redacted.raw).toEqual({});
  });
});

describe("resolveRedactionPolicy", () => {
  it("is off by default and on only when explicitly enabled", () => {
    expect(resolveRedactionPolicy(undefined).enabled).toBe(false);
    expect(resolveRedactionPolicy({}).enabled).toBe(false);
    expect(
      resolveRedactionPolicy({ redaction: { enabled: false } }).enabled,
    ).toBe(false);
    expect(
      resolveRedactionPolicy({ redaction: { enabled: true } }).enabled,
    ).toBe(true);
  });

  it("TACHY_REDACT=true forces redaction on for every connection (read at call time)", () => {
    expect(globalRedactionEnabled()).toBe(false);
    process.env.TACHY_REDACT = "true";
    try {
      expect(globalRedactionEnabled()).toBe(true);
      expect(resolveRedactionPolicy(undefined).enabled).toBe(true);
      expect(
        resolveRedactionPolicy({ redaction: { enabled: false } }).enabled,
      ).toBe(true);
    } finally {
      delete process.env.TACHY_REDACT;
    }
    expect(resolveRedactionPolicy(undefined).enabled).toBe(false);
  });
});

describe("redactNormalized name scrubbing", () => {
  it("scrubs the requester's and authors' names from free text", () => {
    const item: RawWorkItem = {
      externalId: "1",
      kind: "ticket",
      title: "Jane Doe cannot log in",
      requester: "Jane Doe",
      requesterEmail: "jane@acme.com",
      raw: {},
      messages: [
        {
          visibility: "public",
          direction: "incoming",
          bodyText: "Hi, this is Jane Doe from Acme",
          author: "Jane Doe",
        },
      ],
    };
    const redacted = redactNormalized(item, {
      customerSlug: "acme-corp",
      map: new TokenMap(),
    });
    expect(redacted.title).not.toMatch(/Jane/);
    expect(redacted.messages[0].bodyText).not.toMatch(/Jane/);

    expect(redacted.messages[0].bodyText).toContain(
      redacted.messages[0].author,
    );
  });
});

describe("estimateCostUsd", () => {
  it("prices by model tier and ignores unknown models", () => {
    expect(estimateCostUsd("claude-sonnet-5", 1_000_000, 0)).toBeCloseTo(3);
    expect(estimateCostUsd("claude-opus-4-8", 0, 1_000_000)).toBeCloseTo(25);
    expect(estimateCostUsd("some-other-llm", 1_000_000, 0)).toBeUndefined();
    expect(estimateCostUsd(null, 100, 100)).toBeUndefined();
  });
});
