import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { saveUpload } from "@tachy/core/chat";
import { clearSettingsCache, setSetting } from "@tachy/core/config";
import { extractFile, type ModelImage } from "@tachy/core/files";
import {
  enqueueRun,
  getJobKind,
  presentRun,
  registerCoreJobs,
} from "@tachy/core/jobs";
import {
  getReferenceDoc,
  queueDocExtraction,
  registerPageTranscriber,
  saveReferenceDoc,
  updateReferenceDoc,
  type PageTranscriber,
} from "@tachy/core/reference";
import { completeDocFromPdf } from "../../packages/core/src/reference/pdf-completion";
import { resetData, sql } from "../database";
import { flatPicture, pdfWith } from "../fixtures/files";

afterAll(() => sql.end());

registerCoreJobs();

const never = new AbortController().signal;
const ASSET =
  /!\[Figure on page (\d+)\]\(\/api\/library\/assets\/[0-9a-f-]{36}\)/g;

/** A stand-in for the model: it answers with the size of the page it was shown. */
const reading: PageTranscriber = async (page: ModelImage, reader) =>
  `Scanned text of page ${reader.pageNumber} (${page.widthPx}x${page.heightPx})`;

const logo = flatPicture(200, 150, 10);
const manual = pdfWith([
  {
    text: "Install the controller",
    pictures: [logo, flatPicture(400, 300, 80)],
  },
  { pictures: [flatPicture(600, 800, 120)] },
  { text: "Wire the sensors", pictures: [logo, flatPicture(16, 16, 200)] },
  { text: "Reset the heartbeat", pictures: [logo] },
]);

async function savedFrom(pdf: Uint8Array) {
  const extracted = await extractFile({
    filename: "manual.pdf",
    contentType: "application/pdf",
    bytes: pdf,
  });
  return saveReferenceDoc({ title: "Controller manual", body: extracted.text });
}

beforeEach(async () => {
  await resetData();
  await sql`truncate library_assets, chat_uploads, job_runs cascade`;
  registerPageTranscriber(reading);
});
afterEach(clearSettingsCache);

describe("completeDocFromPdf", () => {
  it("places figures under their page, reads the scanned page, and leaves out decoration", async () => {
    const saved = await savedFrom(manual);
    const completion = await completeDocFromPdf({
      docId: saved.id,
      pdf: manual,
      userId: null,
      signal: never,
    });
    expect(completion).toEqual({ figures: 1, transcribed: 1, scans_left: 0 });

    const doc = await getReferenceDoc(saved.id);
    const pages = (doc.body as string).split(/\n\n(?=\[page )/);
    expect(pages[0]).toMatch(
      /^\[page 1\]\nInstall the controller\n\n!\[Figure on page 1\]\(/,
    );
    expect(pages[1]).toBe("[page 2]\nScanned text of page 2 (600x800)");
    // The logo is on three pages and the icon is 16 px: neither is a figure.
    expect(pages[2]).toBe("[page 3]\nWire the sensors");
    expect(pages[3]).toBe("[page 4]\nReset the heartbeat");
    expect((doc.body as string).match(ASSET)).toHaveLength(1);
    expect(doc.version).toBe(saved.version + 1);

    const [revision] = await sql`
      select actor from library_revisions
      where reference_doc_id = ${saved.id} order by version desc limit 1`;
    expect(revision.actor).toBe("ingest");
    const chunks = await sql`
      select page, chunk_text from reference_doc_chunks
      where doc_id = ${saved.id} order by ordinal`;
    expect(chunks.find((c) => c.page === 2)?.chunk_text).toContain(
      "Scanned text of page 2",
    );
  });

  it("changes nothing when the PDF has neither figures nor scans", async () => {
    const plain = pdfWith([{ text: "Only words here" }]);
    const saved = await savedFrom(plain);
    expect(
      await completeDocFromPdf({
        docId: saved.id,
        pdf: plain,
        userId: null,
        signal: never,
      }),
    ).toEqual({ figures: 0, transcribed: 0, scans_left: 0 });
    expect((await getReferenceDoc(saved.id)).version).toBe(saved.version);
  });

  it("refuses to overwrite a doc that was edited while its PDF was read", async () => {
    const saved = await savedFrom(manual);
    registerPageTranscriber(async (_page, reader) => {
      await updateReferenceDoc(saved.id, { title: "Edited meanwhile" });
      return reading(_page, reader);
    });
    await expect(
      completeDocFromPdf({
        docId: saved.id,
        pdf: manual,
        userId: null,
        signal: never,
      }),
    ).rejects.toThrow(/version|modified|changed/i);
    expect((await getReferenceDoc(saved.id)).body).not.toContain(
      "Scanned text",
    );
  });

  it("leaves the scans and says why when nobody can read them", async () => {
    const complete = async () => {
      const saved = await savedFrom(manual);
      return completeDocFromPdf({
        docId: saved.id,
        pdf: manual,
        userId: null,
        signal: never,
      });
    };
    registerPageTranscriber(async () => null);
    expect(await complete()).toMatchObject({
      figures: 1,
      transcribed: 0,
      scans_left: 1,
      scans_note: "no model credential to read them with",
    });

    registerPageTranscriber(reading);
    await setSetting("redaction_global", true);
    expect(await complete()).toMatchObject({
      transcribed: 0,
      scans_left: 1,
      scans_note: "redaction is on and images are withheld from the model",
    });
    await setSetting("redaction_images", true);
    expect(await complete()).toMatchObject({ transcribed: 1, scans_left: 0 });
  });

  it("scrubs what it read off a page when redaction is on", async () => {
    await setSetting("redaction_global", true);
    await setSetting("redaction_images", true);
    registerPageTranscriber(
      async () => "Contact ana.ops@example.com for parts",
    );
    const saved = await savedFrom(manual);
    await completeDocFromPdf({
      docId: saved.id,
      pdf: manual,
      userId: null,
      signal: never,
    });
    const { body } = await getReferenceDoc(saved.id);
    expect(body).toContain("Contact [EMAIL_1] for parts");
    expect(body).not.toContain("ana.ops@example.com");
  });

  it("counts a scanned page with no words, or no picture, as left", async () => {
    registerPageTranscriber(async () => "   ");
    const pdf = pdfWith([
      { text: "Words on this page" },
      { pictures: [flatPicture(600, 800, 50)] },
      {},
    ]);
    const saved = await savedFrom(pdf);
    expect(
      await completeDocFromPdf({
        docId: saved.id,
        pdf,
        userId: null,
        signal: never,
      }),
    ).toEqual({
      figures: 0,
      transcribed: 0,
      scans_left: 2,
      scans_note: "the others hold no picture to read, or no words",
    });
  });

  it("stops when the run is cancelled", async () => {
    const saved = await savedFrom(manual);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      completeDocFromPdf({
        docId: saved.id,
        pdf: manual,
        userId: null,
        signal: cancelled.signal,
      }),
    ).rejects.toThrow();
  });
});

describe("reference.extract", () => {
  const ctx = (requestedBy: string | null) => ({
    runId: "test",
    requestedBy,
    signal: never,
    progress: async () => {},
    log: () => {},
    credential: async () => undefined,
    enqueue: (kind: string, params: unknown) =>
      enqueueRun({ kind, params, trigger: "event" }),
  });

  it("reads the upload of whoever saved the doc and completes it", async () => {
    const author = await createUser({ email: "author@example.com" });
    const upload = await saveUpload({
      userId: author.id,
      filename: "manual.pdf",
      contentType: "application/pdf",
      bytes: manual,
    });
    const saved = await savedFrom(manual);
    const kind = getJobKind("reference.extract");
    const params = kind.params.parse({
      doc_id: saved.id,
      path: upload.ref,
      user_id: author.id,
    }) as Record<string, unknown>;
    const output = await kind.run(ctx(author.id), params);
    expect(output).toEqual({ figures: 1, transcribed: 1, scans_left: 0 });
    expect(presentRun("reference.extract", params, output!)).toEqual({
      subject: "manual.pdf",
      outcome: "1 figure, 1 scanned page read",
    });

    // An upload that is gone, or another person's, reads the same from here.
    await expect(
      kind.run(ctx(null), { ...params, user_id: null }),
    ).rejects.toThrow(/no longer held/);
  });

  it("says in its outcome which scans were left and why", () => {
    expect(
      presentRun(
        "reference.extract",
        { path: "upload:x/scan.pdf" },
        {
          figures: 0,
          transcribed: 0,
          scans_left: 3,
          scans_note: "no model credential to read them with",
        },
      ).outcome,
    ).toBe(
      "0 figures, 0 scanned pages read, 3 scanned pages left: no model credential to read them with",
    );
  });

  it("is queued once per doc, from a process that registered no kinds", async () => {
    const saved = await savedFrom(manual);
    const input = {
      docId: saved.id,
      path: "upload:x/manual.pdf",
      userId: null,
    };
    const first = await queueDocExtraction(input);
    expect(first).toBeTruthy();
    expect(await queueDocExtraction(input)).toBeNull();
    const [run] = await sql`
      select kind, queue, trigger, params from job_runs where id = ${first}`;
    expect(run).toMatchObject({
      kind: "reference.extract",
      queue: "embed",
      trigger: "event",
      params: { doc_id: saved.id, path: "upload:x/manual.pdf", user_id: null },
    });
  });
});
