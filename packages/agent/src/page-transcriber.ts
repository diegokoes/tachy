import { userSoleTeamId } from "@tachy/core/access";
import type { ScopeContext } from "@tachy/core/config";
import { registerPageTranscriber } from "@tachy/core/reference";
import { runAdvisory } from "./advisory";

const SYSTEM = `You transcribe one scanned page of a document. Write out every
word on it in reading order, as plain text: a heading on its own line, a table
as one line per row with its cells separated by tabs. Keep the wording and the
language exactly as printed. Where something cannot be read, write
[illegible]. Describe a picture or a diagram in one line inside square
brackets. Add nothing of your own: no summary, no comment, no code fences. If
the page holds no words, answer with nothing at all.`;

/**
 * Reading a scanned page takes a model, which only this package reaches; the
 * processes that work the job register it at start. The cheap tier: it is
 * copying, not judging.
 */
export function registerAgentPageTranscriber(): void {
  registerPageTranscriber(async (page, reader) => {
    const scope: ScopeContext = reader.userId
      ? {
          userId: reader.userId,
          teamId: (await userSoleTeamId(reader.userId)) ?? undefined,
        }
      : {};
    return runAdvisory(
      {
        system: SYSTEM,
        prompt: () => "Transcribe this page.",
        images: [page],
        tier: "cheap",
        timeoutMs: 120_000,
        mode: "ingest",
        meta: { doc_id: reader.docId, page: reader.pageNumber },
      },
      scope,
      reader.userId,
    );
  });
}
