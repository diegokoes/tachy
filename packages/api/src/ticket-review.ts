import type {
  ReviewFinding,
  ReviewFindingKind,
  ReviewReadiness,
  ScopeContext,
  TicketContextItem,
  TicketReview,
} from "@tachy/core";
import { firstJsonObject, runAdvisory } from "./advisory";

export interface ReviewRequest {
  type: string;
  title: string;
  fields: { ref: string; name: string; value: string }[];
  images: number;
  context: TicketContextItem[];
}

const MAX_FINDINGS = 8;
const MAX_FIELD = 6000;
const MAX_CONTEXT = 6000;

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
  const t = type.toLowerCase();
  if (/bug|defect|incident|issue|problem/.test(t)) return CHECKLISTS.bug;
  if (/story|feature|requirement|backlog|epic/.test(t)) return CHECKLISTS.story;
  if (/change/.test(t)) return CHECKLISTS.change;
  if (/task/.test(t)) return CHECKLISTS.task;
  return CHECKLISTS.generic;
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n[… cut at ${n} characters]` : s;

export function reviewPrompt(
  r: ReviewRequest,
  scrub: (s: string) => string = (s) => s,
): string {
  const parts = [
    checklistFor(r.type),
    `Work item type: ${r.type}`,
    `[System.Title] ${scrub(r.title) || "(empty)"}`,
    ...r.fields.map(
      (f) => `[${f.ref}] ${f.name}:\n${scrub(clip(f.value, MAX_FIELD))}`,
    ),
  ];
  if (r.images)
    parts.push(
      `The author pasted ${r.images} image(s) you cannot see. Do not ask for screenshots.`,
    );
  if (r.context.length)
    parts.push(
      "Context items the author attached:",
      ...r.context.map(
        (c) =>
          `--- ${c.source} #${c.external_id}: ${scrub(c.title)}\n${scrub(clip(c.text, MAX_CONTEXT))}`,
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
  for (const f of Array.isArray(parsed?.findings) ? parsed.findings : []) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message.trim() : "";
    if (!message) continue;
    const field =
      typeof o.field === "string" && known.has(o.field) ? o.field : "general";
    const suggestion =
      typeof o.suggestion === "string" && o.suggestion.trim()
        ? o.suggestion.trim()
        : undefined;
    findings.push({
      id: `f${findings.length + 1}`,
      field,
      kind: KINDS.has(o.kind as ReviewFindingKind)
        ? (o.kind as ReviewFindingKind)
        : "improve",
      message,
      ...(suggestion ? { suggestion } : {}),
    });
    if (findings.length === MAX_FINDINGS) break;
  }
  const readiness = READINESS.has(parsed?.readiness as ReviewReadiness)
    ? (parsed!.readiness as ReviewReadiness)
    : findings.length
      ? "almost"
      : "ready";
  return {
    available: true,
    readiness,
    summary:
      typeof parsed?.summary === "string"
        ? parsed.summary.trim()
        : parsed
          ? ""
          : "The review came back unreadable. Ask again.",
    findings,
  };
}

/** One-shot, on the caller's own model: this judgement is the feature. */
export async function reviewTicket(
  r: ReviewRequest,
  ctx: ScopeContext,
  userId: string | null,
): Promise<TicketReview> {
  const text = await runAdvisory(
    {
      system: SYSTEM,
      prompt: (scrub) => reviewPrompt(r, scrub),
      tier: "caller",
      timeoutMs: 90_000,
      mode: "review",
      meta: { review: "ado_ticket", type: r.type, context: r.context.length },
    },
    ctx,
    userId,
  );
  if (text === null)
    return { available: false, readiness: "almost", summary: "", findings: [] };
  return parseTicketReview(
    text,
    r.fields.map((f) => f.ref),
  );
}
