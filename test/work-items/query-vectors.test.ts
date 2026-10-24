/**
 * ticketQueryVectors embeds a window of a ticket's thread once, and the item
 * keeps the vectors of its latest windows only.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ticketQueryVectors } from "@tachy/core/work-items";
import { EMBEDDING_MODEL, embedQueryLiteral } from "@tachy/core/search";
import * as embeddings from "../../packages/core/src/search/embeddings";
import { resetData, sql } from "../database";

vi.mock("../../packages/core/src/search/embeddings", async (original) => {
  const actual = await original<typeof embeddings>();
  return { ...actual, embedQueryLiteral: vi.fn(actual.embedQueryLiteral) };
});

const embedCalls = vi.mocked(embeddings.embedQueryLiteral);

afterAll(() => sql.end());

const SYMPTOM =
  "Since the upgrade the handheld scanner shows offline and cannot be paired again.";
const REPLY =
  "Thanks for writing in. Could you send a screenshot of the pairing screen and the firmware version?";
const FOLLOW_UP =
  "The firmware is 4.2 and the pairing screen never opens, the log shows ECONNREFUSED.";

let workItemId: string;

beforeEach(async () => {
  await resetData();
  const [row] = await sql<{ id: string }[]>`
    insert into work_items (source_connection_id, external_id, title)
    select id, 'qv-1', 'Scanner offline' from source_connections
    where slug = 'test-freshdesk'
    returning id
  `;
  workItemId = row.id;
  embedCalls.mockClear();
});

/** Cosine distance between two vector literals, 0 for the same vector. */
async function distance(a: string, b: string) {
  const [{ d }] = await sql`select ${a}::vector <=> ${b}::vector as d`;
  return Number(d);
}

async function storedRows() {
  return sql<{ embedding_model: string; text_sha256: string }[]>`
    select embedding_model, text_sha256 from work_item_query_vectors
    where work_item_id = ${workItemId} order by created_at, text_sha256
  `;
}

describe("ticketQueryVectors", () => {
  it("embeds each window once and gives the vectors in the windows' order", async () => {
    const windows = [SYMPTOM, REPLY];
    const vectors = await ticketQueryVectors(workItemId, windows);
    expect(embedCalls).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(2);
    for (const [i, window] of windows.entries())
      expect(
        await distance(vectors[i], await embedQueryLiteral(window)),
      ).toBeLessThan(1e-6);
    expect(await storedRows()).toHaveLength(2);
  });

  it("reads back the windows of an earlier open without embedding them", async () => {
    const first = await ticketQueryVectors(workItemId, [SYMPTOM, REPLY]);
    embedCalls.mockClear();
    const again = await ticketQueryVectors(workItemId, [SYMPTOM, REPLY]);
    expect(embedCalls).not.toHaveBeenCalled();
    for (const [i, vector] of again.entries())
      expect(await distance(vector, first[i])).toBeLessThan(1e-6);
  });

  it("embeds only a new message and keeps the latest windows only", async () => {
    await ticketQueryVectors(workItemId, [SYMPTOM, REPLY]);
    embedCalls.mockClear();
    await ticketQueryVectors(workItemId, [SYMPTOM, REPLY, FOLLOW_UP]);
    expect(embedCalls).toHaveBeenCalledTimes(1);
    expect(embedCalls).toHaveBeenCalledWith(FOLLOW_UP);
    expect(await storedRows()).toHaveLength(3);

    embedCalls.mockClear();
    await ticketQueryVectors(workItemId, [SYMPTOM, FOLLOW_UP]);
    expect(embedCalls).not.toHaveBeenCalled();
    expect(await storedRows()).toHaveLength(2);
  });

  it("embeds a window the thread holds twice once", async () => {
    const vectors = await ticketQueryVectors(workItemId, [SYMPTOM, SYMPTOM]);
    expect(embedCalls).toHaveBeenCalledTimes(1);
    expect(vectors[0]).toBe(vectors[1]);
    expect(await storedRows()).toHaveLength(1);
  });

  it("ignores and drops the vectors of another model", async () => {
    await ticketQueryVectors(workItemId, [SYMPTOM]);
    const [{ text_sha256 }] = await storedRows();
    const elsewhere = `[${Array(768).fill(0.01).join(",")}]`;
    await sql`
      update work_item_query_vectors
      set embedding_model = 'another-model', embedding = ${elsewhere}::vector
      where work_item_id = ${workItemId}
    `;
    embedCalls.mockClear();
    const [vector] = await ticketQueryVectors(workItemId, [SYMPTOM]);
    expect(embedCalls).toHaveBeenCalledTimes(1);
    expect(
      await distance(vector, await embedQueryLiteral(SYMPTOM)),
    ).toBeLessThan(1e-6);
    expect(await storedRows()).toEqual([
      { embedding_model: EMBEDDING_MODEL, text_sha256 },
    ]);
  });

  it("keeps nothing for a thread with no windows", async () => {
    await ticketQueryVectors(workItemId, [SYMPTOM]);
    expect(await ticketQueryVectors(workItemId, [])).toEqual([]);
    expect(await storedRows()).toEqual([]);
  });

  it("goes with its work item", async () => {
    await ticketQueryVectors(workItemId, [SYMPTOM]);
    await sql`delete from work_items where id = ${workItemId}`;
    expect(await storedRows()).toEqual([]);
  });

  it("serves two opens of the same ticket at once", async () => {
    const [a, b] = await Promise.all([
      ticketQueryVectors(workItemId, [SYMPTOM, REPLY]),
      ticketQueryVectors(workItemId, [SYMPTOM, REPLY]),
    ]);
    for (const [i, vector] of a.entries())
      expect(await distance(vector, b[i])).toBeLessThan(1e-6);
    expect(await storedRows()).toHaveLength(2);
  });
});
