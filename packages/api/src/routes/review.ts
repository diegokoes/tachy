import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  acceptProposal,
  getProposal,
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
import type { ProposalRow } from "@tachy/core";
import {
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

const scopeOf = (proposal: ProposalRow) => ({
  productId: proposal.product_id,
  teamId: proposal.team_id,
});

/** The proposal, for a caller who may decide it. */
async function reviewedProposal(c: Context): Promise<ProposalRow> {
  const proposal = await getProposal(c.req.param("id")!);
  await assertScopeEditor(c, scopeOf(proposal));
  return proposal;
}

type Party = "submitter" | "reviewer";

/** Which side of the proposal the caller is on; throws for anyone else. */
async function partyTo(c: Context, proposal: ProposalRow): Promise<Party> {
  const userId = await callerUserId(c);
  if (userId && userId === proposal.submitted_by) return "submitter";
  if (await isScopeEditor(c, scopeOf(proposal))) return "reviewer";
  throw forbidden("this proposal is neither yours nor yours to review");
}

export const review = new Hono()
  .get("/queue", async (c) => {
    const teams = await reviewerTeams(c);
    const [proposals, drafts] = await Promise.all([
      listProposalQueue(teams),
      listUnproposedDrafts(teams),
    ]);
    return c.json({ proposals, drafts });
  })

  .get("/mine", async (c) =>
    c.json(await listMyProposals(await requireCaller(c))),
  )

  .get("/count", async (c) =>
    c.json(await reviewCount(await callerUserId(c), await reviewerTeams(c))),
  )

  .get("/proposals/:id", async (c) => {
    const proposal = await getProposal(c.req.param("id"));
    await partyTo(c, proposal);
    return c.json(proposal);
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
      const direction = await partyTo(c, proposal);
      const posted = await replyOnProposal(
        proposal,
        { userId: await callerUserId(c), direction },
        c.req.valid("json").message,
      );
      return c.json(posted, 201);
    },
  );
