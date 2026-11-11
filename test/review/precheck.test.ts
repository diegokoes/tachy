import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearPermissionCache, createUser } from "@tachy/core/access";
import { addComponent } from "@tachy/core/catalog";
import { getJobKind } from "@tachy/core/jobs";
import { saveKnowledgeEntry, type KnowledgeInput } from "@tachy/core/knowledge";
import {
  getAdviceSubject,
  getProposal,
  listUnadvisedProposals,
  resubmitProposal,
  returnProposal,
  saveOrProposeEntry,
  setProposalAdvice,
  updateOrProposeEntry,
} from "@tachy/core/review";
import type { Submitter } from "@tachy/core/review";
import {
  adviseOnProposal,
  entryReviewPrompt,
  registerAgentReviewJobs,
} from "../../packages/agent/src/entry-review";
import { resetData, sql, tqxProductId } from "../database";
import { disableVault } from "../vault";

afterAll(() => sql.end());
registerAgentReviewJobs();

let memberId = "";
let leadId = "";
let productId = "";

const asMember = (): Submitter => ({
  actor: { userId: memberId, actor: "web" },
  canEdit: false,
});

const complete: KnowledgeInput = {
  title: "Label queue stalls after a spooler restart",
  issueSummary: "Labels stop printing until the queue is cleared by hand.",
  rootCause: "the spooler keeps a stale lock file",
  resolution: "delete the lock file and restart the spooler",
  relatedLinks: ["https://docs.example.com/spooler"],
};

async function proposed(input: KnowledgeInput) {
  const submission = await saveOrProposeEntry(
    { productId, ...input },
    asMember(),
  );
  return submission.proposal_id!;
}

const codesOf = async (proposalId: string) =>
  (await getProposal(proposalId)).precheck?.checks.map((c) => c.code);

beforeEach(async () => {
  await resetData();
  clearPermissionCache();
  disableVault();
  memberId = (await createUser({ email: "member@example.com" })).id;
  leadId = (await createUser({ email: "lead@example.com" })).id;
  productId = await tqxProductId();
  await addComponent({ productId, slug: "printing", name: "Printing" });
});

describe("the checks at submit", () => {
  it("finds nothing on an entry that has its cause, fix, component and source", async () => {
    expect(
      await codesOf(await proposed({ ...complete, component: "printing" })),
    ).toEqual([]);
  });

  it("names what a thin new entry lacks", async () => {
    expect(
      await codesOf(await proposed({ title: "Scanner drops off after sleep" })),
    ).toEqual(["no_root_cause", "no_resolution", "no_component", "no_source"]);
  });

  it("accepts an unknown cause that is marked low confidence", async () => {
    const codes = await codesOf(
      await proposed({ ...complete, rootCause: undefined, confidence: "low" }),
    );
    expect(codes).toEqual(["no_component"]);
  });

  it("points at the live entry a new one nearly repeats", async () => {
    const live = await saveKnowledgeEntry({ ...complete, productId });

    const proposal = await getProposal(await proposed(complete));

    expect(proposal.precheck?.checks[0]).toMatchObject({
      code: "near_copy",
      copies: [{ id: live.id, title: complete.title }],
    });
  });

  it("checks an edit only in the fields it changes", async () => {
    const live = await saveKnowledgeEntry({
      productId,
      title: "Invoice export is empty",
      resolution: "clear the export cache",
    });
    const propose = async (patch: Record<string, unknown>) =>
      (await updateOrProposeEntry(live.id as string, patch, asMember()))
        .proposal_id!;

    expect(await codesOf(await propose({ tags: ["billing"] }))).toEqual([]);
    expect(await codesOf(await propose({ resolution: null }))).toEqual([
      "no_resolution",
    ]);
  });

  it("checks again when a returned draft is fixed and resubmitted, and drops the old remarks", async () => {
    const submission = await saveOrProposeEntry(
      {
        productId,
        title: "Scanner drops off after sleep",
        component: "printing",
      },
      asMember(),
    );
    const proposalId = submission.proposal_id!;
    await setProposalAdvice(proposalId, {
      available: true,
      ok: false,
      suggestions: ["say what fixed it"],
    });
    await returnProposal(
      proposalId,
      { userId: leadId, actor: "web" },
      "what fixed it?",
    );

    await updateOrProposeEntry(
      submission.id,
      {
        rootCause: "the lease expires during sleep",
        resolution: "pin the lease",
        relatedLinks: ["https://docs.example.com/lease"],
      },
      asMember(),
    );
    await resubmitProposal(proposalId, memberId);

    const { precheck } = await getProposal(proposalId);
    expect(precheck).toEqual({ checks: [] });
  });
});

describe("the model's reading", () => {
  it("is given the entry as the proposal would leave it", async () => {
    const live = await saveKnowledgeEntry({ ...complete, productId });
    const { proposal_id: proposalId } = await updateOrProposeEntry(
      live.id as string,
      { resolution: "delete spool.lock, then restart" },
      asMember(),
    );

    const subject = await getAdviceSubject(proposalId!);
    const prompt = entryReviewPrompt(subject, (text) =>
      text.replace("spool.lock", "[FILE]"),
    );

    expect(subject).toMatchObject({ kind: "edit", submittedBy: memberId });
    expect(prompt).toContain("ENTRY AFTER A PROPOSED CHANGE");
    expect(prompt).toContain("Resolution: delete [FILE], then restart");
    expect(prompt).toContain("Root cause: the spooler keeps a stale lock file");
    expect(prompt).toContain("Symptoms: (none)");
    expect(entryReviewPrompt({ ...subject, kind: "new" })).toContain(
      "PROPOSED NEW ENTRY",
    );
  });

  it("stores the remarks beside the checks", async () => {
    const proposalId = await proposed({
      title: "Scanner drops off after sleep",
    });

    await adviseOnProposal(proposalId, async () => ({
      available: true,
      ok: false,
      suggestions: ["say which access point"],
    }));

    const { precheck } = await getProposal(proposalId);
    expect(precheck?.checks).toHaveLength(4);
    expect(precheck?.advice).toEqual({
      available: true,
      ok: false,
      suggestions: ["say which access point"],
    });
  });

  it("leaves no remarks, and asks no model, where the submitter has no credential", async () => {
    const proposalId = await proposed(complete);

    const advice = await adviseOnProposal(proposalId);

    expect(advice).toEqual({ available: false, ok: true, suggestions: [] });
    expect(await listUnadvisedProposals()).toEqual([]);
  });

  it("reads each unread open proposal once from the job", async () => {
    const first = await proposed(complete);
    await proposed({ ...complete, title: "A second lesson" });
    await adviseOnProposal(first, async () => ({
      available: true,
      ok: true,
      suggestions: [],
    }));
    expect(await listUnadvisedProposals()).toHaveLength(1);
    const kind = getJobKind("review.precheck");
    const run = () =>
      kind.run(
        { signal: new AbortController().signal } as never,
        {},
      ) as Promise<Record<string, unknown>>;

    expect(await run()).toEqual({ read: 1 });
    expect(await run()).toEqual({ read: 0 });
    expect(kind.outcome!({ read: 2 })).toBe("2 read");
    expect(kind.outcome!({ read: 0 })).toBe("nothing new");
  });
});
