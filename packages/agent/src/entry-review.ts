import type { ProposalAdvice } from "@tachy/core";
import { userSoleTeamId } from "@tachy/core/access";
import { defineJob } from "@tachy/core/jobs";
import {
  getAdviceSubject,
  listUnadvisedProposals,
  setProposalAdvice,
  type AdviceSubject,
} from "@tachy/core/review";
import { z } from "zod";
import { runAdvisory } from "./advisory";
import { parseReview } from "./report-review";

const REVIEW_SYSTEM = `You read a proposed knowledge entry, or a proposed change to one, before a curator decides on it. The archive holds what past support tickets taught: a problem, its cause, and what fixed it.

Judge only whether a colleague facing the same problem could act on it. Is the cause stated precisely, or plainly marked unknown rather than guessed? Does the resolution say what to change and under which conditions? Are error codes and symptoms quoted as they appear? Is anything true of one customer written as true of the product? Be brief and concrete. Never rewrite the entry.

Reply with ONLY a JSON object, no prose and no code fences:
{"ok": boolean, "suggestions": string[]}
"ok" is true when a curator could accept it as it stands. "suggestions" is at most three short things to add or clarify (empty when ok).`;

const FIELD_LABELS: [keyof AdviceSubject, string][] = [
  ["title", "Title"],
  ["issueSummary", "Summary"],
  ["rootCause", "Root cause"],
  ["resolution", "Resolution"],
  ["investigation", "Investigation"],
  ["confidence", "Confidence"],
];

/** The proposal as the model reads it: the entry it would leave, field by field. */
export function entryReviewPrompt(
  subject: AdviceSubject,
  scrub: (text: string) => string = (text) => text,
): string {
  const heading =
    subject.kind === "new"
      ? "PROPOSED NEW ENTRY"
      : "ENTRY AFTER A PROPOSED CHANGE";
  const fields = FIELD_LABELS.map(([field, label]) => {
    const value = subject[field];
    return `${label}: ${typeof value === "string" && value ? scrub(value) : "(none)"}`;
  });
  const symptoms = subject.symptoms.length
    ? subject.symptoms.map(scrub).join("; ")
    : "(none)";
  return [heading, "", ...fields, `Symptoms: ${symptoms}`].join("\n");
}

const NO_CREDENTIAL: ProposalAdvice = {
  available: false,
  ok: true,
  suggestions: [],
};

/**
 * Asks the submitter's own model whether a proposal can be acted on. With no
 * credential there are no remarks, and a failed call passes the proposal.
 */
export async function reviewEntry(
  subject: AdviceSubject,
): Promise<ProposalAdvice> {
  const userId = subject.submittedBy;
  const scope = userId
    ? { userId, teamId: (await userSoleTeamId(userId)) ?? undefined }
    : {};
  const text = await runAdvisory(
    {
      system: REVIEW_SYSTEM,
      prompt: (scrub) => entryReviewPrompt(subject, scrub),
      tier: "cheap",
      timeoutMs: 30_000,
      mode: "review",
      meta: { proposal_kind: subject.kind },
    },
    scope,
    userId,
  );
  return text === null ? NO_CREDENTIAL : parseReview(text);
}

/** Reads one proposal and stores the remarks on it. */
export async function adviseOnProposal(
  proposalId: string,
  review: (subject: AdviceSubject) => Promise<ProposalAdvice> = reviewEntry,
): Promise<ProposalAdvice> {
  const advice = await review(await getAdviceSubject(proposalId));
  await setProposalAdvice(proposalId, advice);
  return advice;
}

/**
 * The job that reads what the API did not: proposals made through the agent's
 * tools, and any whose first reading was lost with the process.
 */
export function registerAgentReviewJobs(): void {
  defineJob({
    kind: "review.precheck",
    title: "read new proposals",
    description:
      "has the model read each open proposal it has not read yet and leave its remarks for the reviewer. uses the submitter's model credential",
    params: z.object({}),
    defaultSchedule: "*/5 * * * *",
    outcome: (o) => (o.read ? `${o.read} read` : "nothing new"),
    timeout: "15m",
    run: async (ctx) => {
      let read = 0;
      for (const proposalId of await listUnadvisedProposals()) {
        if (ctx.signal.aborted) break;
        await adviseOnProposal(proposalId);
        read++;
      }
      return { read };
    },
  });
}
