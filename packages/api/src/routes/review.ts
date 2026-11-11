import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  acceptProposal,
  dismissSignal,
  entryReview,
  getProposal,
  getSignal,
  listSignals,
  muteSignal,
  sweepSignals,
  listMyProposals,
  listProposalQueue,
  listUnproposedDrafts,
  rejectProposal,
  replyOnProposal,
  resubmitProposal,
  returnProposal,
  reviewCount,
  withdrawProposal,
} from "@tachy/core/review";
import { forbidden } from "@tachy/core/infra";
import type { ProposalRow, SignalRow } from "@tachy/core";
import {
  assertAnyTeamAdminApi,
  assertScopeEditor,
  callerActor,
  callerUserId,
  isScopeEditor,
  requireCaller,
  reviewerTeams,
} from "../authz";
import { validate } from "../validation";
import { knowledgeUpdateSchema } from "./knowledge";

const MAX_MESSAGE_CHARS = 4000;

const messageSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});
const acceptSchema = z.object({ edits: knowledgeUpdateSchema.optional() });
const resubmitSchema = z.object({
  note: z.string().trim().max(MAX_MESSAGE_CHARS).optional(),
});

const scopeOf = (row: Pick<ProposalRow, "product_id" | "team_id">) => ({
  productId: row.product_id,
  teamId: row.team_id,
});

/** The proposal, for a caller who may decide it. */
async function reviewedProposal(c: Context): Promise<ProposalRow> {
  const proposal = await getProposal(c.req.param("id")!);
  await assertScopeEditor(c, scopeOf(proposal));
  return proposal;
}

/** The signal, for a caller who curates its entry. */
async function reviewedSignal(c: Context): Promise<SignalRow> {
  const signal = await getSignal(c.req.param("id")!);
  await assertScopeEditor(c, scopeOf(signal));
  return signal;
}

type Viewer = NonNullable<ProposalRow["viewer"]>;

/** The sides of the proposal the caller is on; throws for someone on neither. */
async function viewerOf(c: Context, proposal: ProposalRow): Promise<Viewer> {
  const userId = await callerUserId(c);
  const viewer = {
    submitter: userId !== null && userId === proposal.submitted_by,
    reviewer: await isScopeEditor(c, scopeOf(proposal)),
  };
  if (!viewer.submitter && !viewer.reviewer)
    throw forbidden("this proposal is neither yours nor yours to review");
  return viewer;
}

export const review = new Hono()
  .get("/queue", async (c) => {
    const teams = await reviewerTeams(c);
    const [proposals, drafts, signals] = await Promise.all([
      listProposalQueue(teams),
      listUnproposedDrafts(teams),
      listSignals(teams),
    ]);
    return c.json({ proposals, drafts, signals });
  })

  .get("/mine", async (c) =>
    c.json(await listMyProposals(await requireCaller(c))),
  )

  .get("/count", async (c) =>
    c.json(await reviewCount(await callerUserId(c), await reviewerTeams(c))),
  )

  .get("/proposals/:id", async (c) => {
    const proposal = await getProposal(c.req.param("id"));
    return c.json({ ...proposal, viewer: await viewerOf(c, proposal) });
  })

  .get("/entries/:entryId", async (c) =>
    c.json(await entryReview(c.req.param("entryId"), await callerUserId(c))),
  )

  .post("/signals/rescan", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await sweepSignals());
  })

  .post("/signals/:id/dismiss", async (c) => {
    const signal = await reviewedSignal(c);
    await dismissSignal(signal.id, await callerUserId(c));
    return c.json({ dismissed: signal.id });
  })

  .post("/signals/:id/mute", async (c) => {
    const signal = await reviewedSignal(c);
    await muteSignal(signal.id, await callerUserId(c));
    return c.json({ muted: signal.id });
  })

  .post("/proposals/:id/accept", validate("json", acceptSchema), async (c) => {
    const proposal = await reviewedProposal(c);
    return c.json(
      await acceptProposal(
        proposal.id,
        await callerActor(c),
        c.req.valid("json").edits,
      ),
    );
  })

  .post("/proposals/:id/return", validate("json", messageSchema), async (c) => {
    const proposal = await reviewedProposal(c);
    return c.json(
      await returnProposal(
        proposal.id,
        await callerActor(c),
        c.req.valid("json").message,
      ),
    );
  })

  .post("/proposals/:id/reject", validate("json", messageSchema), async (c) => {
    const proposal = await reviewedProposal(c);
    return c.json(
      await rejectProposal(
        proposal.id,
        await callerActor(c),
        c.req.valid("json").message,
      ),
    );
  })

  .post(
    "/proposals/:id/resubmit",
    validate("json", resubmitSchema),
    async (c) => {
      const id = c.req.param("id");
      await resubmitProposal(
        id,
        await requireCaller(c),
        c.req.valid("json").note,
      );
      return c.json(await getProposal(id));
    },
  )

  .post("/proposals/:id/withdraw", async (c) => {
    const id = c.req.param("id");
    const userId = await requireCaller(c);
    await withdrawProposal(id, { ...(await callerActor(c)), userId });
    return c.json(await getProposal(id));
  })

  .post(
    "/proposals/:id/messages",
    validate("json", messageSchema),
    async (c) => {
      const proposal = await getProposal(c.req.param("id"));
      const viewer = await viewerOf(c, proposal);
      const posted = await replyOnProposal(
        proposal,
        {
          userId: await callerUserId(c),
          direction: viewer.submitter ? "submitter" : "reviewer",
        },
        c.req.valid("json").message,
      );
      return c.json(posted, 201);
    },
  );
