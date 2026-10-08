import type {
  ReviewFinding,
  ReviewFindingKind,
  ReviewReadiness,
  TicketContextItem,
  TicketReview,
} from "@tachy/core";
import type { ScopeContext } from "@tachy/core/config";
import { firstJsonObject, runAdvisory } from "./advisory";

export interface ReviewRequest {
  type: string;
  title: string;
  fields: { ref: string; name: string; value: string }[];
  images: number;
  context: TicketContextItem[];
  /** The owning team's own guidance for this type, from its flows config. */
  guidance?: string;
}

const MAX_FINDINGS = 8;
const MAX_FIELD_CHARS = 6000;
const MAX_CONTEXT_CHARS = 6000;

const SYSTEM = `You are the developer who will pick this Azure DevOps work item up tomorrow morning, with no chance to ask the person who wrote it. Read it the way that developer would, and point at what they would have to come back and ask.

Rules:
- Review, never rewrite. A suggestion is text the author could insert into ONE field as it stands: a missing step, a sentence, a placeholder such as "Expected: …". Never a rewrite of the whole ticket.
- Be specific to THIS ticket. No generic advice such as "add more detail". Say nothing about what is already fine.
- The context items are what the author is working from (a customer ticket, another work item). Use them to catch facts the ticket should carry and does not: versions, error text, customer impact, steps. Quote them briefly when you do.
- Placeholders such as [EMAIL_1] or [SECRET_1] are deliberate redactions. Never guess what they hide.
- At most ${MAX_FINDINGS} findings, most important first. Fewer is better.

Reply with ONLY a JSON object, no prose and no code fences:
{"readiness": "ready" | "almost" | "needs-work", "summary": string, "findings": [{"field": string, "kind": "gap" | "unclear" | "improve", "message": string, "suggestion"?: string}]}
- readiness: "ready" when a developer could start now; "almost" when one or two things would save a round trip; "needs-work" when they would have to come back before starting.
- summary: one sentence, as the developer would say it to the author.
- field: a reference name exactly as given in brackets, "System.Title", or "general".
- kind: "gap" is missing, "unclear" is there but ambiguous, "improve" is fine but could be sharper.`;

const CHECKLISTS = {
  bug: "This is a defect report. The developer needs exact steps from a known starting state; expected and actual behaviour, both stated; the environment (version, which install, browser or device where it matters); how often and since when, so a regression shows; the impact and any workaround; and evidence (error text, logs). The title should name the symptom and where it happens, not a guessed cause.",
  story:
    "This is a requirement (story, feature, backlog item or epic). The developer needs the problem and who has it, not only the solution; the outcome wanted; acceptance criteria someone can check; what is out of scope; and open questions or dependencies.",
  change:
    "This is a change request. The reviewer needs the reason; what changes and where; the risk and who is affected; how it will be verified; and how it is rolled back.",
  task: "This is a task. The developer needs what done means; enough context to start without a meeting; the larger item it belongs to, if any; and any constraints.",
  generic:
    "Judge it by what the person receiving this kind of item needs to start without asking.",
};

export function checklistFor(type: string): string {
  const lowered = type.toLowerCase();
  if (/bug|defect|incident|issue|problem/.test(lowered)) return CHECKLISTS.bug;
  if (/story|feature|requirement|backlog|epic/.test(lowered))
    return CHECKLISTS.story;
  if (/change/.test(lowered)) return CHECKLISTS.change;
  if (/task/.test(lowered)) return CHECKLISTS.task;
  return CHECKLISTS.generic;
}

const clip = (text: string, maxChars: number) =>
  text.length > maxChars
    ? `${text.slice(0, maxChars)}\n[… cut at ${maxChars} characters]`
    : text;

export function reviewPrompt(
  request: ReviewRequest,
  scrub: (text: string) => string = (s) => s,
): string {
  const parts = [
    checklistFor(request.type),
    ...(request.guidance?.trim()
      ? [
          `The team that owns this project also asks: ${request.guidance.trim()}`,
        ]
      : []),
    `Work item type: ${request.type}`,
    `[System.Title] ${scrub(request.title) || "(empty)"}`,
    ...request.fields.map(
      (f) => `[${f.ref}] ${f.name}:\n${scrub(clip(f.value, MAX_FIELD_CHARS))}`,
    ),
  ];
  if (request.images)
    parts.push(
      `The author pasted ${request.images} image(s) you cannot see. Do not ask for screenshots.`,
    );
  if (request.context.length)
    parts.push(
      "Context items the author attached:",
      ...request.context.map(
        (c) =>
          `--- ${c.source} #${c.external_id}: ${scrub(c.title)}\n${scrub(clip(c.text, MAX_CONTEXT_CHARS))}`,
      ),
    );
  return parts.join("\n\n");
}

const READINESS = new Set<ReviewReadiness>(["ready", "almost", "needs-work"]);
const KINDS = new Set<ReviewFindingKind>(["gap", "unclear", "improve"]);

/** Coerce whatever came back into a review; never throws. */
export function parseTicketReview(
  raw: string,
  knownFields: readonly string[],
): TicketReview {
  const parsed = firstJsonObject(raw);
  const known = new Set(["System.Title", "general", ...knownFields]);
  const findings: ReviewFinding[] = [];
  for (const entry of Array.isArray(parsed?.findings) ? parsed.findings : []) {
    if (!entry || typeof entry !== "object") continue;
    const finding = entry as Record<string, unknown>;
    const message =
      typeof finding.message === "string" ? finding.message.trim() : "";
    if (!message) continue;
    const field =
      typeof finding.field === "string" && known.has(finding.field)
        ? finding.field
        : "general";
    const suggestion =
      typeof finding.suggestion === "string" && finding.suggestion.trim()
        ? finding.suggestion.trim()
        : undefined;
    findings.push({
      id: `f${findings.length + 1}`,
      field,
      kind: KINDS.has(finding.kind as ReviewFindingKind)
        ? (finding.kind as ReviewFindingKind)
        : "improve",
      message,
      ...(suggestion ? { suggestion } : {}),
    });
    if (findings.length === MAX_FINDINGS) break;
  }
  const fallbackReadiness = findings.length ? "almost" : "ready";
  const readiness = READINESS.has(parsed?.readiness as ReviewReadiness)
    ? (parsed!.readiness as ReviewReadiness)
    : fallbackReadiness;
  return {
    available: true,
    readiness,
    summary: reviewSummary(parsed),
    findings,
  };
}

function reviewSummary(parsed: Record<string, unknown> | null): string {
  if (!parsed) return "The review came back unreadable. Ask again.";
  return typeof parsed.summary === "string" ? parsed.summary.trim() : "";
}

/** One-shot, on the caller's own model: this judgement is the feature. */
export async function reviewTicket(
  request: ReviewRequest,
  ctx: ScopeContext,
  userId: string | null,
): Promise<TicketReview> {
  const text = await runAdvisory(
    {
      system: SYSTEM,
      prompt: (scrub) => reviewPrompt(request, scrub),
      tier: "caller",
      timeoutMs: 90_000,
      mode: "review",
      meta: {
        review: "ado_ticket",
        type: request.type,
        context: request.context.length,
      },
    },
    ctx,
    userId,
  );
  if (text === null)
    return { available: false, readiness: "almost", summary: "", findings: [] };
  return parseTicketReview(
    text,
    request.fields.map((f) => f.ref),
  );
}
