import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.FRESHDESK_TOKEN = "test-token";

import {
  registerSource, resolveSource, ingestWorkItem, addCustomer,
  resolveRedactionPolicy, redactForLlm,
} from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { resetData, sql } from "./helpers";

registerSource("freshdesk", createFreshdeskSource);

// A Freshdesk-shaped item carrying PII in the requester email, the raw payload,
// and a message body (signature).
function piiItem(): RawWorkItem {
  return {
    externalId: "58925",
    kind: "ticket",
    title: "Scanner offline — from jane@davidoff.com",
    status: "2",
    groupKey: "48000641379", // seeded -> tpd
    requester: "42",
    requesterEmail: "jane@davidoff.com",
    raw: { id: 58925, email: "jane@davidoff.com", name: "Jane Doe", description_text: "call +1 555 123 4567" },
    messages: [
      { externalId: "m1", visibility: "public", direction: "incoming", bodyText: "reply to jane@davidoff.com", author: "42" },
    ],
  };
}

describe("redaction end-to-end via resolveSource", () => {
  beforeEach(resetData);
  afterEach(async () => {
    await sql`update source_connections set config = '{}'::jsonb where slug = 'test-freshdesk'`;
  });
  afterAll(() => sql.end());

  it("ON: scrubs the LLM copy while the DB keeps full data", async () => {
    await sql`update source_connections set config = ${sql.json({ redaction: { enabled: true } })} where slug = 'test-freshdesk'`;
    await addCustomer({ name: "Davidoff", slug: "davidoff", aliases: ["davidoff.com"] });

    const { conn, source } = await resolveSource("test-freshdesk");
    expect(resolveRedactionPolicy(conn.config).enabled).toBe(true);

    const raw = piiItem();
    const item = await ingestWorkItem(conn.id, raw); // full-data write happens first
    expect(item.customerId).not.toBeNull();          // matching still works on the real email

    // Same logic the MCP handler runs for the model-facing copy.
    const forLlm = redactForLlm(raw, source.redactRaw, "davidoff");
    expect(forLlm.requesterEmail).toBeUndefined();
    expect(forLlm.requester).toBe("davidoff");
    expect(forLlm.title).toMatch(/\[EMAIL_\d+\]/);
    expect((forLlm.raw as any).email).toMatch(/^\[EMAIL_\d+\]$/);
    expect((forLlm.raw as any).name).toBe("davidoff");
    expect((forLlm.raw as any).description_text).toMatch(/\[PHONE_\d+\]/);
    expect(forLlm.messages[0].bodyText).toMatch(/^reply to \[EMAIL_\d+\]$/);

    // The stored rows still hold the real, un-redacted data.
    const [wi] = await sql`select raw, requester from work_items where id = ${item.id}`;
    expect(wi.raw.email).toBe("jane@davidoff.com");
    expect(wi.requester).toBe("42");
    const [msg] = await sql`select body_text from work_item_messages where work_item_id = ${item.id}`;
    expect(msg.body_text).toBe("reply to jane@davidoff.com");
  });

  it("OFF (default config): the connection reports redaction disabled", async () => {
    const { conn } = await resolveSource("test-freshdesk");
    expect(resolveRedactionPolicy(conn.config).enabled).toBe(false);
  });
});
