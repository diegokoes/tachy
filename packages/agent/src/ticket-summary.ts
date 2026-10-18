import { z } from "zod";
import type { ScopeContext } from "@tachy/core/config";
import {
  compactWorkItem,
  renderCompactScript,
  ticketSummarySchema,
  type RawWorkItem,
  type TicketSummary,
} from "@tachy/core/work-items";
import { firstJsonObject, runAdvisory } from "./advisory";

const SYSTEM = `You summarise one support ticket for the colleague who picks it up
next. You get the thread as a de-duplicated script, oldest first. Report only
what the thread says; where it does not say, leave it out. Write in the
language the agents on the ticket write in. Plain sentences, no markdown.
The script names the files on each message; you cannot open them, so say what
one shows only where the thread itself says it.
Answer with one JSON object matching the schema and nothing else.`;

/** The thread and the answer's shape, as the one prompt of the call. */
export function summaryPrompt(raw: RawWorkItem, guidance?: string): string {
  const schema = JSON.stringify(z.toJSONSchema(ticketSummarySchema));
  const asks = guidance?.trim()
    ? `The team that handles these tickets also asks: ${guidance.trim()}\n\n`
    : "";
  return `${asks}JSON schema of the answer:\n${schema}\n\n---\n${renderCompactScript(compactWorkItem(raw))}`;
}

/** Null when the answer holds no object of the summary's shape. */
export function parseSummary(answer: string): TicketSummary | null {
  const parsed = ticketSummarySchema.safeParse(firstJsonObject(answer));
  return parsed.success ? parsed.data : null;
}

export interface SummaryRun {
  /** analysis_runs.mode; a flow's daily limit counts the runs of mode "flow". */
  mode: string;
  /** The admin's guidance for the ticket's group, from its ingest rules. */
  guidance?: string;
  meta?: Record<string, unknown>;
}

/** One model call on the caller's credential; throws when no summary results. */
export async function summarizeTicket(
  raw: RawWorkItem,
  ctx: ScopeContext,
  userId: string | null,
  run: SummaryRun,
): Promise<TicketSummary> {
  const answer = await runAdvisory(
    {
      system: SYSTEM,
      prompt: (scrub) => scrub(summaryPrompt(raw, run.guidance)),
      tier: "caller",
      timeoutMs: 120_000,
      mode: run.mode,
      meta: run.meta,
    },
    ctx,
    userId,
  );
  if (answer === null) throw new Error("no model credential to summarise with");
  if (answer === "") throw new Error("the model call failed");
  const summary = parseSummary(answer);
  if (!summary) throw new Error("the model returned no readable summary");
  return summary;
}
