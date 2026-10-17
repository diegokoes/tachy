/** The work-item routes, each against a fake adapter, so none calls a source. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addCustomer, addCustomerUnit } from "@tachy/core/catalog";
import { ingestWorkItem } from "@tachy/core/work-items";
import {
  addSourceConnection,
  registerSource,
  type RawWorkItem,
  type SourceFactory,
} from "@tachy/core/sources";
import { createApp } from "../../packages/api/src/app";
import sharp from "sharp";
import { json } from "../http";
import { picture } from "../fixtures/files";
import { resetData, seededFreshdeskConnId, sql } from "../database";

afterAll(() => sql.end());

const notes: { id: string; body: string; private?: boolean }[] = [];
let notesSupported = true;

const factory: SourceFactory = () => ({
  type: "fake-items",
  capabilities: { postNote: notesSupported, incrementalSync: false },
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
  async verify() {
    return { identity: "svc@example.invalid", groups: [] };
  },
  ...(notesSupported
    ? {
        async postNote(id: string, body: string, opts?: { private?: boolean }) {
          notes.push({ id, body, private: opts?.private });
        },
      }
    : {}),
});
registerSource("fake-items", factory);

/** What the fake source holds for each attachment id of ticket 42. */
const held = new Map<string, { name: string; bytes: Uint8Array }>();

registerSource("fake-files-api", () => ({
  type: "fake-files-api",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
  async openAttachment(_externalId, attachmentId) {
    const file = held.get(attachmentId);
    if (!file) throw new Error(`42 lists no file '${attachmentId}'`);
    return { name: file.name, body: new Response(file.bytes).body! };
  },
}));

registerSource("fake-fetch-api", () => ({
  type: "fake-fetch-api",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    return {
      externalId: "7",
      kind: "ticket" as const,
      title: "Scanner offline",
      raw: {},
      messages: [
        {
          externalId: "1",
          direction: "incoming" as const,
          visibility: "public" as const,
          bodyText: "The scanner is offline.",
        },
        {
          externalId: "2",
          author: "900",
          direction: "outgoing" as const,
          visibility: "private" as const,
          bodyText: "AI analysis, at length.",
        },
      ],
    };
  },
  async listItems() {
    return { items: [] };
  },
}));

const app = createApp();

const item: RawWorkItem = {
  externalId: "wi-1",
  kind: "ticket",
  title: "printer stops mid-batch",
  raw: {},
  messages: [],
};

async function seedItem(): Promise<string> {
  const ingested = await ingestWorkItem(await seededFreshdeskConnId(), item);
  return ingested.id;
}

beforeEach(async () => {
  await resetData();
  notes.length = 0;
  notesSupported = true;
  await sql`delete from source_connections where slug = 'fake-items-conn'`;
  await sql`
    insert into source_connections (source_type, slug, base_url)
    values ('fake-items', 'fake-items-conn', 'https://example.invalid')
  `;
});

afterAll(async () => {
  await sql`delete from source_connections where slug = 'fake-items-conn'`;
});

describe("POST /api/work-items/:source/:id/notes", () => {
  it("posts a private note through the connection's adapter", async () => {
    const response = await app.request(
      "/api/work-items/fake-items-conn/42/notes",
      json({ body: "Checked the spooler; queue drains now." }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ posted: true });
    // Private by default: a note written during triage is not a customer reply.
    expect(notes).toEqual([
      {
        id: "42",
        body: "Checked the spooler; queue drains now.",
        private: true,
      },
    ]);
  });

  it("rejects an empty body before reaching the source", async () => {
    const response = await app.request(
      "/api/work-items/fake-items-conn/42/notes",
      json({ body: "" }),
    );
    expect(response.status).toBe(400);
    expect(notes).toEqual([]);
  });

  it("404s on a connection slug that does not exist", async () => {
    const response = await app.request(
      "/api/work-items/no-such-conn/42/notes",
      json({ body: "hello" }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(notes).toEqual([]);
  });

  it("says so when the source cannot take notes at all", async () => {
    notesSupported = false;
    const response = await app.request(
      "/api/work-items/fake-items-conn/42/notes",
      json({ body: "hello" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).detail).toMatch(/notes unsupported/i);
  });
});

describe("GET /api/work-items/:source/:id/attachments/:attachmentId", () => {
  const open = (id: string, query = "") =>
    app.request(`/api/work-items/files-api-conn/42/attachments/${id}${query}`);

  beforeEach(async () => {
    await sql`delete from source_connections where slug = 'files-api-conn'`;
    await sql`
      insert into source_connections (source_type, slug, base_url)
      values ('fake-files-api', 'files-api-conn', 'https://example.invalid')
    `;
    held.clear();
    held.set("900", { name: "screen.png", bytes: await picture(2400, 1200) });
    held.set("901", {
      name: "Störung.log",
      bytes: new TextEncoder().encode("ERROR timeout"),
    });
    // A page of markup named as a picture: served as neither.
    held.set("902", {
      name: "trap.png",
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
    });
  });
  afterAll(async () => {
    await sql`delete from source_connections where slug = 'files-api-conn'`;
  });

  it("serves an image as a picture, fitted, and smaller when asked for a thumbnail", async () => {
    const shown = await open("900");
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect(shown.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(shown.headers.get("x-content-type-options")).toBe("nosniff");
    const full = await sharp(Buffer.from(await shown.arrayBuffer())).metadata();
    expect([full.width, full.height]).toEqual([2000, 1000]);

    const thumb = await open("900", "?thumb=1");
    const small = await sharp(
      Buffer.from(await thumb.arrayBuffer()),
    ).metadata();
    expect([small.width, small.height]).toEqual([320, 160]);
  });

  it("serves anything else only as a download, under its own name", async () => {
    for (const id of ["901", "902"]) {
      const response = await open(id);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment; filename="/,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    const log = await open("901");
    expect(log.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''St%C3%B6rung.log",
    );
    expect(await log.text()).toBe("ERROR timeout");
  });

  it("answers a file the ticket does not list, and a source that opens none, as errors", async () => {
    expect((await open("999")).status).toBeGreaterThanOrEqual(400);
    const closed = await app.request(
      "/api/work-items/fake-items-conn/42/attachments/900",
    );
    expect(closed.status).toBe(400);
    expect((await closed.json()).detail).toMatch(/cannot be opened from here/);
  });
});

describe("PATCH /api/work-items/:id/customer", () => {
  it("attributes an item to a customer by slug", async () => {
    const id = await seedItem();
    await addCustomer({ name: "Northwind", slug: "northwind" });

    const response = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "northwind" }),
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).customer_id).toBeTruthy();

    const [row] =
      await sql`select customer_id from work_items where id = ${id}`;
    expect(row.customer_id).toBeTruthy();
  });

  it("files it against one unit of that customer's estate", async () => {
    const id = await seedItem();
    await addCustomer({ name: "Northwind", slug: "northwind" });
    await addCustomerUnit({
      customerSlug: "northwind",
      slug: "line-3",
      name: "Line 3",
      kind: "line",
    });

    const response = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "northwind", unit: "line-3" }),
      method: "PATCH",
    });
    expect(response.status).toBe(200);

    const [row] = await sql`
      select customer_unit_id from work_items where id = ${id}
    `;
    expect(row.customer_unit_id).toBeTruthy();
  });

  it("clears the attribution when the slug is null", async () => {
    const id = await seedItem();
    await addCustomer({ name: "Northwind", slug: "northwind" });
    await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "northwind" }),
      method: "PATCH",
    });

    const response = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: null }),
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).customer_id).toBeNull();
    const [row] =
      await sql`select customer_id from work_items where id = ${id}`;
    expect(row.customer_id).toBeNull();
  });

  it("refuses a customer slug nobody has registered", async () => {
    const id = await seedItem();
    const response = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "no-such-customer" }),
      method: "PATCH",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a body missing customer_slug", async () => {
    const id = await seedItem();
    const response = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ unit: "line-3" }),
      method: "PATCH",
    });
    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/work-items/:id/observed-version", () => {
  it("records the version the customer is actually running", async () => {
    const id = await seedItem();
    const response = await app.request(
      `/api/work-items/${id}/observed-version`,
      {
        ...json({ version: "9.2" }),
        method: "PATCH",
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).observed_version).toBe("9.2");

    const [row] = await sql`
      select observed_version from work_items where id = ${id}
    `;
    expect(row.observed_version).toBe("9.2");
  });

  it("clears it on null", async () => {
    const id = await seedItem();
    await app.request(`/api/work-items/${id}/observed-version`, {
      ...json({ version: "9.2" }),
      method: "PATCH",
    });
    const response = await app.request(
      `/api/work-items/${id}/observed-version`,
      {
        ...json({ version: null }),
        method: "PATCH",
      },
    );
    expect(response.status).toBe(200);
    const [row] = await sql`
      select observed_version from work_items where id = ${id}
    `;
    expect(row.observed_version).toBeNull();
  });

  it("rejects a body with no version key at all", async () => {
    const id = await seedItem();
    const response = await app.request(
      `/api/work-items/${id}/observed-version`,
      {
        ...json({}),
        method: "PATCH",
      },
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/work-items/:source/:id/fetch", () => {
  it("returns the thread without the messages the connection's rules skip", async () => {
    await addSourceConnection({
      sourceType: "fake-fetch-api",
      slug: "fetch-conn",
      baseUrl: "https://example.invalid",
      config: {
        ingest: {
          skip: [
            {
              id: "manager",
              label: "Manager analysis",
              enabled: true,
              where: { field: "message.author", op: "eq", value: "900" },
            },
          ],
        },
      },
    });
    const response = await app.request(
      "/api/work-items/fetch-conn/7/fetch",
      json({}),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.item.messages.map((m: { bodyText: string }) => m.bodyText),
    ).toEqual(["The scanner is offline."]);
    const [stored] = await sql`
      select count(*)::int as n from work_item_messages m
      join work_items w on w.id = m.work_item_id
      where w.external_id = '7'
    `;
    expect(stored.n).toBe(2);
  });
});
