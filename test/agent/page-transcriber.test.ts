/**
 * Reading a scanned page, with the model call stubbed: what the model is asked,
 * on whose credential, and how "no credential" reaches the job.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "@tachy/core/access";
import { extractFile } from "@tachy/core/files";
import { getReferenceDoc, saveReferenceDoc } from "@tachy/core/reference";
import { completeDocFromPdf } from "../../packages/core/src/reference/pdf-completion";
import { registerAgentPageTranscriber } from "../../packages/agent/src/page-transcriber";
import { runAdvisory, type Advisory } from "../../packages/agent/src/advisory";
import { resetData, sql } from "../database";
import { flatPicture, pdfWith } from "../fixtures/files";

vi.mock("../../packages/agent/src/advisory", async (original) => ({
  ...(await original<typeof import("../../packages/agent/src/advisory")>()),
  runAdvisory: vi.fn(),
}));

afterAll(() => sql.end());

const scan = pdfWith([
  { text: "Cover page" },
  { pictures: [flatPicture(600, 800, 40)] },
]);

async function complete(userId: string | null) {
  const { text } = await extractFile({
    filename: "scan.pdf",
    contentType: "application/pdf",
    bytes: scan,
  });
  const saved = await saveReferenceDoc({ title: "Scan", body: text });
  const completion = await completeDocFromPdf({
    docId: saved.id,
    pdf: scan,
    userId,
    policy: { enabled: false, images: true },
    signal: new AbortController().signal,
  });
  return { saved, completion };
}

beforeEach(async () => {
  await resetData();
  vi.mocked(runAdvisory).mockReset();
  registerAgentPageTranscriber();
});

describe("the page transcriber", () => {
  it("shows the model the page, on the saver's credential and the cheap tier", async () => {
    vi.mocked(runAdvisory).mockResolvedValue("Wartung des Druckers");
    const author = await createUser({ email: "author@example.com" });
    const { saved, completion } = await complete(author.id);
    expect(completion).toMatchObject({ transcribed: 1, scans_left: 0 });
    expect((await getReferenceDoc(saved.id)).body).toContain(
      "[page 2]\nWartung des Druckers",
    );

    expect(runAdvisory).toHaveBeenCalledTimes(1);
    const [advisory, scope, userId] = vi.mocked(runAdvisory).mock.calls[0] as [
      Advisory,
      { userId?: string },
      string | null,
    ];
    expect(advisory).toMatchObject({
      tier: "cheap",
      mode: "ingest",
      meta: { doc_id: saved.id, page: 2 },
    });
    expect(advisory.system).toMatch(/transcribe one scanned page/);
    expect(advisory.images).toHaveLength(1);
    expect(advisory.images![0]).toMatchObject({ widthPx: 600, heightPx: 800 });
    expect(scope.userId).toBe(author.id);
    expect(userId).toBe(author.id);
  });

  it("leaves the page when no credential resolves, and when the call fails", async () => {
    vi.mocked(runAdvisory).mockResolvedValue(null);
    expect((await complete(null)).completion).toMatchObject({
      transcribed: 0,
      scans_left: 1,
      scans_note: "no model credential to read them with",
    });
    vi.mocked(runAdvisory).mockResolvedValue("");
    expect((await complete(null)).completion).toMatchObject({
      transcribed: 0,
      scans_left: 1,
    });
  });
});
