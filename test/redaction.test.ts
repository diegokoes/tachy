import { describe, expect, it } from "vitest";

// Set before importing source factories — they read the token at construction.
process.env.FRESHDESK_TOKEN = "test-token";
process.env.GITHUB_TOKEN = "test-token";

import {
  TokenMap, scrubText, redactNormalized, redactForLlm, resolveRedactionPolicy,
  estimateCostUsd, type RawWorkItem,
} from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

describe("scrubText", () => {
  it("tokenizes emails and phones with stable, repeated tokens", () => {
    const map = new TokenMap();
    const out = scrubText("reach me at a@b.com or a@b.com, call +1 (555) 123-4567", map);
    expect(out).toBe("reach me at [EMAIL_1] or [EMAIL_1], call [PHONE_1]");
  });

  it("does not mangle ISO dates or short status codes", () => {
    const map = new TokenMap();
    const out = scrubText("created 2015-08-24, error HTTP 503 seen on 2026-01-02", map);
    expect(out).toBe("created 2015-08-24, error HTTP 503 seen on 2026-01-02");
  });
});

describe("redactNormalized", () => {
  const base: RawWorkItem = {
    externalId: "1", kind: "ticket", title: "email jane@acme.com about login",
    requester: "42", requesterEmail: "jane@acme.com", raw: { keep: "me" },
    messages: [
      { visibility: "public", direction: "incoming", bodyText: "hi from jane@acme.com", author: "42" },
    ],
  };

  it("slugs the requester, drops the email, scrubs text, tokenizes authors", () => {
    const map = new TokenMap();
    const r = redactNormalized(base, { customerSlug: "acme-corp", map });
    expect(r.requester).toBe("acme-corp");
    expect(r.requesterEmail).toBeUndefined();
    expect(r.title).toBe("email [EMAIL_1] about login");
    expect(r.messages[0].bodyText).toBe("hi from [EMAIL_1]");
    expect(r.messages[0].author).toBe("[USER_1]");
  });

  it("falls back to [CUSTOMER] with no slug and never mutates the input", () => {
    const snapshot = structuredClone(base);
    const r = redactNormalized(base, { customerSlug: null, map: new TokenMap() });
    expect(r.requester).toBe("[CUSTOMER]");
    expect(base).toEqual(snapshot); // input untouched
  });
});

describe("freshdesk redactRaw", () => {
  const redact = createFreshdeskSource({ baseUrl: "https://x.freshdesk.com", slug: "fd", config: {} }).redactRaw!;

  it("scrubs the ticket payload but keeps custom-field keys and unrelated data", () => {
    const raw = {
      id: 20, subject: "help",
      email: "jane@acme.com", name: "Jane Doe", phone: "+1 555 123 4567",
      cc_emails: ["cc@acme.com"], to_emails: ["support@vendor.com"], fwd_emails: [],
      twitter_id: "janed", description_text: "reach me at jane@acme.com",
      requester: { id: 42, email: "jane@acme.com", mobile: "+1 555 987 6543", name: "Jane Doe" },
      custom_fields: { cf_devops_work_item: "DevOps#158327", cf_note: "ping ops@acme.com" },
      status: 2,
    };
    const snapshot = structuredClone(raw);
    const out = redact(raw, new TokenMap(), "acme-corp") as any;

    expect(out.email).toMatch(/^\[EMAIL_\d+\]$/);
    expect(out.name).toBe("acme-corp");
    expect(out.phone).toMatch(/^\[PHONE_\d+\]$/);
    expect(out.cc_emails[0]).toMatch(/^\[EMAIL_\d+\]$/);
    expect(out.to_emails[0]).toMatch(/^\[EMAIL_\d+\]$/);
    expect(out.twitter_id).toMatch(/^\[HANDLE_\d+\]$/);
    expect(out.description_text).toBe("reach me at [EMAIL_1]");
    expect(out.requester.name).toBe("acme-corp");
    expect(out.requester.email).toMatch(/^\[EMAIL_\d+\]$/);
    expect(out.custom_fields.cf_devops_work_item).toBe("DevOps#158327");     // no PII → untouched
    expect(out.custom_fields.cf_note).toMatch(/^ping \[EMAIL_\d+\]$/);        // PII scrubbed, key kept
    expect(out.status).toBe(2);                                          // unrelated field intact
    expect(raw).toEqual(snapshot);                                      // input untouched
  });
});

describe("github redactRaw", () => {
  const redact = createGithubSource({ baseUrl: "", slug: "gh", config: { repos: ["o/r"] } }).redactRaw!;

  it("tokenizes actor handles/emails and scrubs body", () => {
    const raw = {
      number: 5, title: "bug from alice@corp.com", body: "email alice@corp.com",
      user: { login: "alice", email: "alice@corp.com" },
    };
    const out = redact(raw, new TokenMap(), null) as any;
    expect(out.user.login).toMatch(/^\[USER_\d+\]$/);
    expect(out.user.email).toMatch(/^\[EMAIL_\d+\]$/);
    expect(out.body).toBe("email [EMAIL_1]");
  });
});

describe("redactForLlm", () => {
  it("redacts normalized fields and the source raw with one consistent token map", () => {
    const redactRaw = createFreshdeskSource({ baseUrl: "https://x.freshdesk.com", slug: "fd", config: {} }).redactRaw!;
    const item: RawWorkItem = {
      externalId: "20", kind: "ticket", title: "login help",
      requester: "42", requesterEmail: "jane@acme.com",
      raw: { id: 20, email: "jane@acme.com", name: "Jane Doe" },
      messages: [{ visibility: "public", direction: "incoming", bodyText: "hi", author: "42" }],
    };
    const out = redactForLlm(item, redactRaw, "acme-corp");
    expect(out.requester).toBe("acme-corp");
    expect(out.requesterEmail).toBeUndefined();
    expect((out.raw as any).email).toMatch(/^\[EMAIL_\d+\]$/);
    expect((out.raw as any).name).toBe("acme-corp");
  });

  it("drops the raw payload when the source has no redactRaw hook", () => {
    const item: RawWorkItem = {
      externalId: "1", kind: "ticket", requester: "u", raw: { secret: "pii" }, messages: [],
    };
    const out = redactForLlm(item, undefined, null);
    expect(out.raw).toEqual({});
  });
});

describe("resolveRedactionPolicy", () => {
  it("is off by default and on only when explicitly enabled", () => {
    expect(resolveRedactionPolicy(undefined).enabled).toBe(false);
    expect(resolveRedactionPolicy({}).enabled).toBe(false);
    expect(resolveRedactionPolicy({ redaction: { enabled: false } }).enabled).toBe(false);
    expect(resolveRedactionPolicy({ redaction: { enabled: true } }).enabled).toBe(true);
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
