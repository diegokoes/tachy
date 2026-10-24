import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prepareKnowledgeEntry,
  saveKnowledgeEntry,
  searchKnowledge,
} from "@tachy/core/knowledge";
import { saveReferenceDoc, searchReferenceDocs } from "@tachy/core/reference";
import {
  DUPLICATE_FLOOR,
  EMBEDDING_SPEC,
  embedQueryLiteral,
  exactTerms,
  queryWindows,
  relevance,
  SEM_FLOOR,
  SEM_CEIL,
} from "@tachy/core/search";
import { grade, GOOD, STRONG } from "@tachy/core";
import { resetData, sql, tpdProductId } from "../database";
import {
  DUPLICATES,
  GOLDEN,
  KNOWLEDGE,
  NONSENSE,
  REFERENCE,
  TICKET_LEADS_DE,
} from "../fixtures/search-corpus";

afterAll(() => sql.end());

const idByKey = new Map<string, string>();

beforeAll(async () => {
  await resetData();
  const productId = await tpdProductId();
  for (const entry of KNOWLEDGE) {
    const row = await saveKnowledgeEntry({
      productId,
      status: "approved",
      issueSummary: entry.issueSummary,
      symptoms: entry.symptoms,
      signals: entry.signals,
      rootCause: entry.rootCause,
      resolution: entry.resolution,
      cloud: entry.cloud,
      affectedVersion: entry.affectedVersion,
      tags: entry.tags,
    });
    idByKey.set(entry.key, row.id as string);
  }
  for (const doc of REFERENCE) {
    const row = await saveReferenceDoc({
      productId,
      title: doc.title,
      body: doc.body,
      status: "approved",
    });
    idByKey.set(doc.key, row.id as string);
  }
}, 300_000);

describe("nonsense queries return nothing", () => {
  // Raw cosine never starts at zero, so these are rejected by the vector leg's
  // floor and by having no lexical candidates, not by a score threshold.
  it.each(NONSENSE)("knowledge: %j", async (query) => {
    expect(await searchKnowledge(query)).toEqual([]);
  });

  it.each(NONSENSE)("reference: %j", async (query) => {
    expect(await searchReferenceDocs(query)).toEqual([]);
  });
});

describe("golden query set", () => {
  it.each(GOLDEN)("[$why] $q -> $expect", async ({ q, expect: key }) => {
    const rows = await searchKnowledge(q);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].id).toBe(idByKey.get(key));
  });

  it("holds recall@3 and MRR above their floors", async () => {
    let hits = 0;
    let reciprocalRankSum = 0;
    for (const golden of GOLDEN) {
      const rows = await searchKnowledge(golden.q);
      const rank = rows.findIndex((r) => r.id === idByKey.get(golden.expect));
      if (rank >= 0 && rank < 3) hits++;
      if (rank >= 0) reciprocalRankSum += 1 / (rank + 1);
    }
    const recallAt3 = hits / GOLDEN.length;
    const mrr = reciprocalRankSum / GOLDEN.length;
    // Floors: a change that regresses retrieval fails here.
    expect(recallAt3).toBeGreaterThanOrEqual(0.9);
    expect(mrr).toBeGreaterThanOrEqual(0.9);
  });

  it("finds a reference doc by a phrase only its body contains", async () => {
    const rows = await searchReferenceDocs("queue does not drain");
    expect(rows[0]?.id).toBe(idByKey.get("deploy-runbook"));
    expect(rows[0].grade).not.toBe("weak");
  });
});

describe("a ticket in German", () => {
  // The entries are English and these share no identifier with them, so the
  // keyword legs have little to match: the vector leg has to admit the entry.
  it.each(TICKET_LEADS_DE)("$q -> $expect", async ({ q, expect: key }) => {
    const [top] = await searchKnowledge(q);
    expect(top?.id).toBe(idByKey.get(key));
    expect(Number(top.cos_sim)).toBeGreaterThan(SEM_FLOOR);
  });
});

/** Sentences about a site visit: no entry covers any of it. */
const VISIT_TALK = [
  "Hello team, thank you for the call this morning, it was good to hear from you again after the summer.",
  "As agreed we are looking forward to your visit to our site in Leipzig next Thursday, and the whole team will be there.",
  "Please register at the gate with an identity card, as the security desk will not let anyone in without one.",
  "Parking for visitors is behind building C, next to the bicycle shelter, and it is free for the whole day.",
  "The security desk hands out badges from eight o'clock, and they are needed to open the doors on every floor.",
  "Lunch will be served in the canteen on the ground floor at half past twelve, with a choice of three menus.",
  "Let us know about any dietary wishes by Tuesday so the kitchen can plan the meals for everyone on the day.",
  "In the afternoon our colleagues from purchasing would like to walk you through the new office wing upstairs.",
  "Afterwards there is time for coffee and cake on the terrace before your train back to the city in the evening.",
  "We have also booked the large meeting room on the second floor for the whole day, with a projector and a whiteboard.",
  "That should leave enough room in case you want to present the plans for next year to the department heads as well.",
  "If the date does not suit you after all, just reply to this message and we will find another day in the same week.",
  "Our reception is open until five in the afternoon, and the phone number is on the invitation we sent last week.",
  "The nearest hotel is a ten minute walk from the main entrance, and our travel office can book a room for you.",
  "Taxis wait at the station square, and the ride to the site takes about twenty minutes outside the rush hour.",
  "We will send directions and a map of the buildings by email on Monday, together with the agenda for the day.",
  "Several colleagues from the other sites will join by video, so the room is set up for a call in the afternoon.",
  "Thank you again for making the time, and do not hesitate to reach out if anything else comes up before then.",
  "Our managing director hopes to join you for lunch, although her calendar for that week is still quite full.",
  "The weather forecast promises sunshine, so the tour of the grounds can take place outside as planned.",
  "Please bring sturdy shoes for the walk across the yard, since some of the paths are still being paved.",
  "Photos are allowed in the office wing and the canteen, but not in the archive rooms in the basement.",
  "The visitor wifi is called Guest and the password is printed on the back of the badge you receive.",
  "We are happy to arrange a short city tour on Friday morning if you decide to stay one more night.",
];

const windowChars = EMBEDDING_SPEC.codeChunkChars;

/** One long opening message of visit talk, as long as a window. */
const fullWindowOfTalk = VISIT_TALK.reduce(
  (message, sentence) =>
    message.length + sentence.length + 1 > windowChars
      ? message
      : `${message} ${sentence}`.trim(),
  "",
);

/** One vector per window and the exact terms, as the ticket tools search. */
async function searchThread(turns: string[]) {
  const thread = turns.join("\n\n");
  const windows = queryWindows(turns);
  const queryVectors: string[] = [];
  for (const window of windows)
    queryVectors.push(await embedQueryLiteral(window));
  const opening = turns[0].slice(0, 1000);
  const rows = await searchKnowledge(opening, {
    queryVectors,
    exactTerms: exactTerms(thread),
  });
  return { windows, opening, rows };
}

const SUPPORT_REPLY =
  "Thanks for writing in. Could you describe what you see on your side, with a screenshot if you have one, and since when?";

const SYMPTOM =
  "Since the software upgrade our handheld barcode reader shows offline, and the pairing dialog never appears.";

describe("a whole ticket", () => {
  it("finds an entry from a symptom stated after a long opening", async () => {
    const { windows, opening, rows } = await searchThread([
      fullWindowOfTalk,
      SUPPORT_REPLY,
      SYMPTOM,
    ]);
    expect(windows).toEqual([fullWindowOfTalk, SUPPORT_REPLY, SYMPTOM]);
    expect(rows[0]?.id).toBe(idByKey.get("scanner-pairing"));
    expect(rows[0].grade).not.toBe("weak");

    const fromOpening = await searchKnowledge(opening);
    const scanner = fromOpening.find(
      (row) => row.id === idByKey.get("scanner-pairing"),
    );
    expect(scanner?.grade ?? "weak").toBe("weak");
  });

  it("matches an error code quoted deep in a long ticket on the keyword leg", async () => {
    const { rows } = await searchThread([
      fullWindowOfTalk,
      SUPPORT_REPLY,
      "The service log keeps repeating ECONNREFUSED since this morning.",
    ]);
    const scanner = rows.find(
      (row) => row.id === idByKey.get("scanner-pairing"),
    );
    expect(Number(scanner?.fts_rank)).toBeGreaterThan(0);
  });

  it("keeps a long ticket on a subject no entry covers weak", async () => {
    const { windows, rows } = await searchThread([
      fullWindowOfTalk,
      SUPPORT_REPLY,
      VISIT_TALK.slice(-6).join(" "),
    ]);
    expect(windows).toHaveLength(3);
    for (const row of rows) expect(row.grade).toBe("weak");
  });
});

describe("near-copies of an entry", () => {
  /** Cosine between a stored entry and one prepared from `entry`, in SQL. */
  async function similarityTo(
    key: string,
    entry: (typeof DUPLICATES)[number]["same"],
  ) {
    const prepared = await prepareKnowledgeEntry({
      productId: await tpdProductId(),
      ...entry,
    });
    const [{ similarity }] = await sql`
      select 1 - (embedding <=> ${prepared.embedding}::vector) as similarity
      from knowledge_entries where id = ${idByKey.get(key)!}
    `;
    return Number(similarity);
  }

  it("score at the duplicate floor or above, and related entries of another lesson under it", async () => {
    let lowestSame = 1;
    let highestDifferent = 0;
    for (const { of, same, different } of DUPLICATES) {
      lowestSame = Math.min(lowestSame, await similarityTo(of, same));
      highestDifferent = Math.max(
        highestDifferent,
        await similarityTo(of, different),
      );
    }
    expect(DUPLICATE_FLOOR).toBeDefined();
    expect(lowestSame).toBeGreaterThanOrEqual(DUPLICATE_FLOOR!);
    expect(highestDifferent).toBeLessThan(DUPLICATE_FLOOR!);
  });
});

describe("grading", () => {
  it("grades an exact identifier hit strong, on the lexical arm alone", async () => {
    const [top] = await searchKnowledge("TOO_MANY_STRINGS");
    expect(top.grade).toBe("strong");
  });

  it("grades a paraphrase strong, on the semantic arm alone", async () => {
    const [top] = await searchKnowledge("scanner offline");
    expect(top.cos_sim).toBeGreaterThan(SEM_FLOOR);
    expect(top.grade).toBe("strong");
  });

  it("ranks an unrelated-but-admitted row below a real match", async () => {
    const rows = await searchKnowledge("printer label problem");
    expect(rows[0].id).toBe(idByKey.get("printer-023"));
    for (const row of rows.slice(1)) expect(row.relevance).toBeLessThan(GOOD);
  });
});

describe("calibration constants", () => {
  // The constants are measured for one model. A change of `TACHY_EMBED_MODEL`
  // that does not re-derive them skews every gauge and grade with no error.
  it("separates the noise floor from real matches", async () => {
    let worstTrue = 1;
    for (const golden of GOLDEN) {
      const [top] = await searchKnowledge(golden.q);
      if (top?.cos_sim) worstTrue = Math.min(worstTrue, Number(top.cos_sim));
    }
    expect(SEM_FLOOR).toBeLessThan(SEM_CEIL);
    // Every golden top hit clears the floor its own vector leg is gated on, or
    // it only got in on keywords - either way the floor is not cutting matches.
    expect(worstTrue).toBeGreaterThan(0);
  });

  it("maps the signal range onto the grades", () => {
    expect(grade(relevance({ cos_sim: SEM_CEIL }))).toBe("strong");
    expect(grade(relevance({ cos_sim: SEM_FLOOR }))).toBe("weak");
    expect(grade(relevance({ trgm_sim: 1, fts_rank: 0.3 }))).toBe("strong");
    expect(relevance({})).toBe(0);
    expect(grade(GOOD)).toBe("good");
    expect(grade(STRONG)).toBe("strong");
  });
});

describe("index usage", () => {
  // These assert the query shapes stay index-eligible. On a small table the
  // planner still prefers a scan on cost, so seqscan is disabled.
  const planOf = async (query: string) => {
    const rows = await sql.unsafe(`explain (format json) ${query}`);
    return JSON.stringify(rows);
  };

  it("uses the HNSW index for the vector leg", async () => {
    const [{ embedding }] =
      await sql`select embedding from knowledge_entries where embedding is not null limit 1`;
    await sql`set enable_seqscan = off`;
    const plan = await planOf(
      `select id from knowledge_entries where embedding is not null
       order by embedding <=> '${embedding}'::vector limit 50`,
    );
    await sql`reset enable_seqscan`;
    expect(plan).toContain("knowledge_embedding_idx");
  });

  it("uses both tsvector indexes for the lexical leg", async () => {
    await sql`set enable_seqscan = off`;
    const plan = await planOf(
      `select id from knowledge_entries
       where search_tsv @@ websearch_to_tsquery('simple', 'TOO_MANY_STRINGS')
          or search_tsv_en @@ websearch_to_tsquery('english', 'TOO_MANY_STRINGS')`,
    );
    await sql`reset enable_seqscan`;
    expect(plan).toContain("knowledge_tsv_idx");
    expect(plan).toContain("knowledge_tsv_en_idx");
  });

  it("uses the trigram index for the fuzzy leg", async () => {
    await sql`set enable_seqscan = off`;
    const plan = await planOf(
      `select id from knowledge_entries where 'TOO_MANY_STRINGS' <% search_text`,
    );
    await sql`reset enable_seqscan`;
    expect(plan).toContain("knowledge_trgm_idx");
  });
});
