import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.FRESHDESK_TOKEN = "test-token";

import {
  registerSource,
  resolveSource,
  ingestWorkItem,
  addCustomer,
  resolveRedactionPolicy,
  redactForLlm,
} from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { resetData, sql } from "../helpers";

registerSource("freshdesk", createFreshdeskSource);

function piiItem(): RawWorkItem {
  return {
    externalId: "40123",
    kind: "ticket",
    title: "Scanner offline — from jane@dalmoor.example",
    status: "2",
    groupKey: "70000000013",
    requester: "42",
    requesterEmail: "jane@dalmoor.example",
    raw: {
      id: 40123,
      email: "jane@dalmoor.example",
      name: "Jane Doe",
      description_text: "call +1 555 123 4567",
    },
    messages: [
      {
        externalId: "m1",
        visibility: "public",
        direction: "incoming",
        bodyText: "reply to jane@dalmoor.example",
        author: "42",
      },
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
    await addCustomer({
      name: "Dalmoor",
      slug: "dalmoor",
      emailDomains: ["dalmoor.example"],
    });

    const { conn, source } = await resolveSource("test-freshdesk");
    expect(resolveRedactionPolicy(conn.config).enabled).toBe(true);

    const raw = piiItem();
    const item = await ingestWorkItem(conn.id, raw);
    expect(item.customerId).not.toBeNull();

    const forLlm = redactForLlm(raw, source.redactRaw, "dalmoor");
    expect(forLlm.requesterEmail).toBeUndefined();
    expect(forLlm.requester).toBe("dalmoor");
    expect(forLlm.title).toMatch(/\[EMAIL_\d+\]/);
    expect((forLlm.raw as any).email).toMatch(/^\[EMAIL_\d+\]$/);
    expect((forLlm.raw as any).name).toBe("dalmoor");
    expect((forLlm.raw as any).description_text).toMatch(/\[PHONE_\d+\]/);
    expect(forLlm.messages[0].bodyText).toMatch(/^reply to \[EMAIL_\d+\]$/);

    const [wi] =
      await sql`select raw, requester from work_items where id = ${item.id}`;
    expect(wi.raw.email).toBe("jane@dalmoor.example");
    expect(wi.requester).toBe("42");
    const [msg] =
      await sql`select body_text from work_item_messages where work_item_id = ${item.id}`;
    expect(msg.body_text).toBe("reply to jane@dalmoor.example");
  });

  it("OFF (default config): the connection reports redaction disabled", async () => {
    const { conn } = await resolveSource("test-freshdesk");
    expect(resolveRedactionPolicy(conn.config).enabled).toBe(false);
  });
});
