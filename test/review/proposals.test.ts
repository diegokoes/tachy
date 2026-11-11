import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearPermissionCache,
  createUser,
  setTeamMember,
} from "@tachy/core/access";
import { addComponent, addProduct, addTeam } from "@tachy/core/catalog";
import {
  getKnowledgeEntry,
  saveKnowledgeEntry,
  searchKnowledge,
  updateKnowledgeEntry,
} from "@tachy/core/knowledge";
import type { KnowledgeUpdateInput } from "@tachy/core/knowledge";
import { listRevisions } from "@tachy/core/library";
import type { ActorRef } from "@tachy/core/library";
import { listNotifications } from "@tachy/core/notifications";
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
  saveOrProposeEntry,
  updateOrProposeEntry,
  withdrawProposal,
} from "@tachy/core/review";
import type { Submitter } from "@tachy/core/review";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

let memberId = "";
let leadId = "";
let productId = "";
let testTeamId = "";
let otherTeamId = "";

const webActor = (userId: string): ActorRef => ({ userId, actor: "web" });
const asMember = (note?: string): Submitter => ({
  actor: webActor(memberId),
  canEdit: false,
  note,
});
const asLead = (): ActorRef => webActor(leadId);

const lesson = {
  title: "Label queue stalls after a spooler restart",
  issueSummary: "Labels stop printing until the queue is cleared by hand.",
  rootCause: "the spooler keeps a stale lock file",
  resolution: "delete the lock file and restart the spooler",
};

async function liveEntry() {
  const saved = await saveKnowledgeEntry({ ...lesson, productId });
  return saved.id as string;
}

async function proposeNew(note?: string) {
  const submission = await saveOrProposeEntry(
    { ...lesson, productId },
    asMember(note),
  );
  return { entryId: submission.id, proposalId: submission.proposal_id! };
}

async function proposeEdit(
  entryId: string,
  patch: KnowledgeUpdateInput = { resolution: "reboot" },
) {
  const submission = await updateOrProposeEntry(entryId, patch, asMember());
  return submission.proposal_id!;
}

beforeEach(async () => {
  await resetData();
  clearPermissionCache();
  memberId = (await createUser({ email: "member@example.com" })).id;
  leadId = (await createUser({ email: "lead@example.com" })).id;
  await setTeamMember("test-team", "lead@example.com", "admin");
  productId = await tpdProductId();
  const [testTeam] = await sql`select id from teams where slug = 'test-team'`;
  testTeamId = testTeam.id as string;
  otherTeamId = (await addTeam("other-team", "Other Team")).id;
});

describe("proposing a new entry", () => {
  it("stores a draft outside search and queues it for the product's team", async () => {
    const { entryId, proposalId } = await proposeNew("seen on two tickets");

    expect((await getKnowledgeEntry(entryId)).status).toBe("draft");
    expect(await searchKnowledge("label queue stalls spooler")).toHaveLength(0);

    const queue = await listProposalQueue([testTeamId]);
    expect(queue.map((p) => p.id)).toEqual([proposalId]);
    expect(queue[0]).toMatchObject({
      kind: "new",
      status: "open",
      note: "seen on two tickets",
      submitted_by: memberId,
      submitter_name: "member@example.com",
      entry_title: lesson.title,
    });
    expect(await listProposalQueue([otherTeamId])).toHaveLength(0);
    expect(await listProposalQueue(null)).toHaveLength(1);
  });

  it("saves directly for an editor, with no proposal", async () => {
    const submission = await saveOrProposeEntry(
      { ...lesson, productId },
      { actor: asLead(), canEdit: true },
    );
    expect(submission).toMatchObject({ proposed: false, status: "approved" });
    expect(await listProposalQueue(null)).toHaveLength(0);
  });

  it("refuses a caller with no account, and a disabled one", async () => {
    await expect(
      saveOrProposeEntry(lesson, { actor: { actor: "api" }, canEdit: false }),
    ).rejects.toThrow(/signed-in account/);

    await sql`update users set disabled = true where id = ${memberId}`;
    clearPermissionCache();
    await expect(saveOrProposeEntry(lesson, asMember())).rejects.toThrow(
      /signed-in account/,
    );
  });

  it("publishes on accept, with one revision by the reviewer and a notice", async () => {
    const { entryId, proposalId } = await proposeNew();

    const accepted = await acceptProposal(proposalId, asLead());

    expect(accepted).toMatchObject({
      status: "accepted",
      decided_by: leadId,
      accepted_version: 2,
      entry_status: "approved",
    });
    expect(
      (await searchKnowledge("label queue stalls spooler")).map((r) => r.id),
    ).toEqual([entryId]);
    const [latest] = await listRevisions({ entryId });
    expect(latest).toMatchObject({
      version: 2,
      user_id: leadId,
      changed_fields: ["status"],
    });
    const [notice] = await listNotifications(memberId);
    expect(notice).toMatchObject({
      kind: "review_reply",
      title: "your proposed entry was accepted",
      ref: { proposal_id: proposalId, entry_id: entryId, event: "accepted" },
    });
  });

  it("takes the reviewer's own edits with the acceptance", async () => {
    const { entryId, proposalId } = await proposeNew();

    await acceptProposal(proposalId, asLead(), { confidence: "high" });

    expect(await getKnowledgeEntry(entryId)).toMatchObject({
      status: "approved",
      confidence: "high",
    });
  });

  it("moves a rejected draft to rejected and keeps the reason on the thread", async () => {
    const { entryId, proposalId } = await proposeNew();

    const rejected = await rejectProposal(
      proposalId,
      asLead(),
      "already covered by the spooler article",
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.messages?.map((m) => [m.direction, m.body_text])).toEqual([
      ["reviewer", "already covered by the spooler article"],
    ]);
    expect((await getKnowledgeEntry(entryId)).status).toBe("rejected");
    const [notice] = await listNotifications(memberId);
    expect(notice.title).toBe("your proposed entry was rejected");
    expect(notice.body_text).toBe("already covered by the spooler article");
  });

  it("lets the submitter fix a returned draft and resubmit it", async () => {
    const { entryId, proposalId } = await proposeNew();
    await returnProposal(proposalId, asLead(), "name the lock file");
    expect((await getProposal(proposalId)).status).toBe("returned");
    expect(await reviewCount(memberId, [])).toMatchObject({
      waiting: 0,
      returned: 1,
    });

    const edited = await updateOrProposeEntry(
      entryId,
      { resolution: "delete spool.lock and restart the spooler" },
      asMember(),
    );
    expect(edited).toMatchObject({ proposed: true, proposal_id: proposalId });
    expect((await getKnowledgeEntry(entryId)).resolution).toContain(
      "spool.lock",
    );

    await resubmitProposal(proposalId, memberId, "named it");
    expect(await getProposal(proposalId)).toMatchObject({
      status: "open",
      note: "named it",
    });
    expect(await reviewCount(leadId, [testTeamId])).toMatchObject({
      waiting: 1,
      returned: 0,
    });
  });

  it("keeps a draft closed to other members and to status changes", async () => {
    const { entryId } = await proposeNew();
    const stranger = await createUser({ email: "stranger@example.com" });

    await expect(
      updateOrProposeEntry(
        entryId,
        { resolution: "mine now" },
        { actor: webActor(stranger.id), canEdit: false },
      ),
    ).rejects.toThrow(/someone else's/);
    await expect(
      updateOrProposeEntry(entryId, { status: "approved" }, asMember()),
    ).rejects.toThrow(/reviewer's to set/);
  });

  it("archives the draft when its submitter withdraws", async () => {
    const { entryId, proposalId } = await proposeNew();

    await expect(
      withdrawProposal(proposalId, { ...asLead(), userId: leadId }),
    ).rejects.toThrow(/someone else's/);
    await withdrawProposal(proposalId, { actor: "web", userId: memberId });

    expect((await getProposal(proposalId)).status).toBe("withdrawn");
    expect((await getKnowledgeEntry(entryId)).status).toBe("archived");
    await expect(acceptProposal(proposalId, asLead())).rejects.toThrow(
      /withdrawn, not open/,
    );
    await expect(
      withdrawProposal(proposalId, { actor: "web", userId: memberId }),
    ).rejects.toThrow(/already withdrawn/);
  });
});

describe("proposing an edit", () => {
  it("leaves the live entry as it is until a reviewer accepts", async () => {
    const entryId = await liveEntry();

    const submission = await updateOrProposeEntry(
      entryId,
      { resolution: "reboot the print server", expectedVersion: 1 },
      asMember("the restart alone did not hold"),
    );

    expect(submission).toMatchObject({ proposed: true, version: 1 });
    expect((await getKnowledgeEntry(entryId)).resolution).toBe(
      lesson.resolution,
    );
    expect(await getProposal(submission.proposal_id!)).toMatchObject({
      kind: "edit",
      patch: { resolution: "reboot the print server" },
      base_version: 1,
      conflicting_fields: [],
    });

    await acceptProposal(submission.proposal_id!, asLead());

    expect(await getKnowledgeEntry(entryId)).toMatchObject({
      resolution: "reboot the print server",
      version: 2,
    });
    const [notice] = await listNotifications(memberId);
    expect(notice.title).toBe("your proposed change was accepted");
  });

  it("replaces the same person's waiting edit instead of stacking a second", async () => {
    const entryId = await liveEntry();
    const first = await proposeEdit(entryId, { resolution: "first try" });
    const second = await proposeEdit(entryId, { resolution: "second try" });

    expect(second).toBe(first);
    expect(await listMyProposals(memberId)).toHaveLength(1);
    expect((await getProposal(first)).patch).toEqual({
      resolution: "second try",
    });
  });

  it("applies over a later edit to other fields", async () => {
    const entryId = await liveEntry();
    const proposalId = await proposeEdit(entryId);
    await updateKnowledgeEntry(entryId, { tags: ["spooler"] }, asLead());

    expect((await getProposal(proposalId)).conflicting_fields).toEqual([]);
    await acceptProposal(proposalId, asLead());

    expect(await getKnowledgeEntry(entryId)).toMatchObject({
      resolution: "reboot",
      tags: ["spooler"],
      version: 3,
    });
  });

  it("refuses a patch that overlaps a later edit until the reviewer settles it", async () => {
    const entryId = await liveEntry();
    const proposalId = await proposeEdit(entryId);
    await updateKnowledgeEntry(
      entryId,
      { resolution: "clear the queue first" },
      asLead(),
    );

    expect((await getProposal(proposalId)).conflicting_fields).toEqual([
      "resolution",
    ]);
    await expect(acceptProposal(proposalId, asLead())).rejects.toMatchObject({
      code: "conflict",
      extensions: { fields: ["resolution"] },
    });

    await acceptProposal(proposalId, asLead(), {
      resolution: "clear the queue, then reboot",
    });
    expect((await getKnowledgeEntry(entryId)).resolution).toBe(
      "clear the queue, then reboot",
    );
  });

  it("sees a component change as a conflict on the component field", async () => {
    await addComponent({ productId, slug: "printing", name: "Printing" });
    await addComponent({ productId, slug: "coding", name: "Coding" });
    const entryId = await liveEntry();
    const proposalId = await proposeEdit(entryId, { component: "printing" });
    await updateKnowledgeEntry(entryId, { component: "coding" }, asLead());

    expect((await getProposal(proposalId)).conflicting_fields).toEqual([
      "component",
    ]);
  });

  it("refuses at submit what the entry's update would refuse", async () => {
    const entryId = await liveEntry();

    await expect(
      updateOrProposeEntry(entryId, { component: "no-such-part" }, asMember()),
    ).rejects.toThrow(/no-such-part/);
    await expect(
      updateOrProposeEntry(
        entryId,
        { resolution: "x", expectedVersion: 7 },
        asMember(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      updateOrProposeEntry(entryId, { expectedVersion: 1 }, asMember()),
    ).rejects.toThrow(/empty/);
    expect(await listMyProposals(memberId)).toHaveLength(0);
  });

  it("lets a member propose a deprecation and no other status", async () => {
    const entryId = await liveEntry();

    await expect(
      updateOrProposeEntry(entryId, { status: "archived" }, asMember()),
    ).rejects.toThrow(/'deprecated' only/);

    const proposalId = await proposeEdit(entryId, { status: "deprecated" });
    await acceptProposal(proposalId, asLead());
    expect((await getKnowledgeEntry(entryId)).status).toBe("deprecated");
  });

  it("takes no proposals on an entry that is not live", async () => {
    const entryId = await liveEntry();
    await updateKnowledgeEntry(entryId, { status: "archived" }, asLead());

    await expect(
      updateOrProposeEntry(entryId, { resolution: "x" }, asMember()),
    ).rejects.toThrow(/archived takes no proposed changes/);
  });

  it("leaves the entry alone on reject and reopens nothing on a second decision", async () => {
    const entryId = await liveEntry();
    const proposalId = await proposeEdit(entryId);

    await rejectProposal(proposalId, asLead(), "the restart is the fix");

    expect(await getKnowledgeEntry(entryId)).toMatchObject({
      resolution: lesson.resolution,
      status: "approved",
      version: 1,
    });
    await expect(returnProposal(proposalId, asLead(), "again")).rejects.toThrow(
      /rejected, not open/,
    );
    await expect(resubmitProposal(proposalId, memberId)).rejects.toThrow(
      /rejected, not sent back/,
    );
  });
});

describe("the review thread", () => {
  it("notifies the submitter of a reviewer's reply and not of their own", async () => {
    const { proposalId } = await proposeNew();
    const proposal = await getProposal(proposalId);

    await replyOnProposal(
      proposal,
      { userId: leadId, direction: "reviewer" },
      "which printer model?",
    );
    await replyOnProposal(
      proposal,
      { userId: memberId, direction: "submitter" },
      "the zt411",
    );

    const thread = (await getProposal(proposalId)).messages ?? [];
    expect(thread.map((m) => [m.direction, m.author_name])).toEqual([
      ["reviewer", "lead@example.com"],
      ["submitter", "member@example.com"],
    ]);
    const notices = await listNotifications(memberId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      title: "a reviewer replied on your proposed entry",
      body_text: "which printer model?",
    });
    expect(await listNotifications(leadId)).toHaveLength(0);
  });

  it("sends no notice when a person decides their own proposal", async () => {
    const { proposalId } = await proposeNew();

    await acceptProposal(proposalId, webActor(memberId));

    expect(await listNotifications(memberId)).toHaveLength(0);
  });
});

describe("the queue", () => {
  it("lists drafts nobody proposed apart from the proposals", async () => {
    await proposeNew();
    const own = await saveKnowledgeEntry({
      title: "Half-written note on scanner pairing",
      productId,
      status: "draft",
      createdById: leadId,
    });

    const drafts = await listUnproposedDrafts([testTeamId]);

    expect(drafts.map((d) => d.id)).toEqual([own.id]);
    expect(drafts[0].author_name).toBe("lead@example.com");
    expect(await listUnproposedDrafts([otherTeamId])).toHaveLength(0);
  });

  it("scopes a proposal by the entry's team when it has no product", async () => {
    const other = await addProduct("other-team", "op", "Other Product");
    await saveOrProposeEntry({ ...lesson, productId: other.id }, asMember());
    await saveOrProposeEntry(
      { ...lesson, title: "Team-only lesson", teamId: testTeamId },
      asMember(),
    );

    expect(
      (await listProposalQueue([testTeamId])).map((p) => p.entry_title),
    ).toEqual(["Team-only lesson"]);
    expect(
      (await listProposalQueue([otherTeamId])).map((p) => p.entry_title),
    ).toEqual([lesson.title]);
  });

  it("puts open proposals ahead of returned ones", async () => {
    const first = await proposeNew();
    const second = await saveOrProposeEntry(
      { ...lesson, title: "A second lesson", productId },
      asMember(),
    );
    await returnProposal(first.proposalId, asLead(), "more detail");

    expect((await listProposalQueue(null)).map((p) => p.id)).toEqual([
      second.proposal_id,
      first.proposalId,
    ]);
  });
});
