import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  addCustomerUnit,
  ingestWorkItem,
  registerSource,
  type RawWorkItem,
  type SourceFactory,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, resetData, seededFreshdeskConnId, sql } from "./helpers";

afterAll(() => sql.end());

/**
 * `POST /:source/:id/fetch` is deliberately absent: it calls the third-party
 * API, which is the same line load/README.md draws for the k6 scenarios. The
 * rest of the file is reachable without one.
 */
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
    const res = await app.request(
      "/api/work-items/fake-items-conn/42/notes",
      json({ body: "Checked the spooler; queue drains now." }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ posted: true });
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
    const res = await app.request(
      "/api/work-items/fake-items-conn/42/notes",
      json({ body: "" }),
    );
    expect(res.status).toBe(400);
    expect(notes).toEqual([]);
  });

  it("404s on a connection slug that does not exist", async () => {
    const res = await app.request(
      "/api/work-items/no-such-conn/42/notes",
      json({ body: "hello" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(notes).toEqual([]);
  });

  it("says so when the source cannot take notes at all", async () => {
    notesSupported = false;
    const res = await app.request(
      "/api/work-items/fake-items-conn/42/notes",
      json({ body: "hello" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/notes unsupported/i);
  });
});

describe("PATCH /api/work-items/:id/customer", () => {
  it("attributes an item to a customer by slug", async () => {
    const id = await seedItem();
    await addCustomer({ name: "Northwind", slug: "northwind" });

    const res = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "northwind" }),
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).customer_id).toBeTruthy();

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

    const res = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "northwind", unit: "line-3" }),
      method: "PATCH",
    });
    expect(res.status).toBe(200);

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

    const res = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: null }),
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).customer_id).toBeNull();
    const [row] =
      await sql`select customer_id from work_items where id = ${id}`;
    expect(row.customer_id).toBeNull();
  });

  it("refuses a customer slug nobody has registered", async () => {
    const id = await seedItem();
    const res = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ customer_slug: "no-such-customer" }),
      method: "PATCH",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a body missing customer_slug", async () => {
    const id = await seedItem();
    const res = await app.request(`/api/work-items/${id}/customer`, {
      ...json({ unit: "line-3" }),
      method: "PATCH",
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/work-items/:id/observed-version", () => {
  it("records the version the customer is actually running", async () => {
    const id = await seedItem();
    const res = await app.request(`/api/work-items/${id}/observed-version`, {
      ...json({ version: "9.2" }),
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).observed_version).toBe("9.2");

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
    const res = await app.request(`/api/work-items/${id}/observed-version`, {
      ...json({ version: null }),
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    const [row] = await sql`
      select observed_version from work_items where id = ${id}
    `;
    expect(row.observed_version).toBeNull();
  });

  it("rejects a body with no version key at all", async () => {
    const id = await seedItem();
    const res = await app.request(`/api/work-items/${id}/observed-version`, {
      ...json({}),
      method: "PATCH",
    });
    expect(res.status).toBe(400);
  });
});
