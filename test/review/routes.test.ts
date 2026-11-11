import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearPermissionCache,
  createUser,
  setTeamMember,
} from "@tachy/core/access";
import { addTeam } from "@tachy/core/catalog";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql, tqxProductId } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const PASSWORD = "a-long-password";

let memberCookie = "";
let leadCookie = "";
let outsiderCookie = "";
let productId = "";

function requestAs(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    ...(body === undefined ? {} : json(body)),
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Cookie: cookie,
    },
  });
}

async function signedIn(email: string): Promise<string> {
  await createUser({ email, password: PASSWORD });
  return loginCookie(app, email, PASSWORD);
}

const lesson = () => ({
  productId,
  title: "Scanner drops off the network after sleep",
  issueSummary: "Handhelds lose their lease when they wake.",
  resolution: "pin the lease on the access point",
});

async function proposedEntry() {
  const response = await requestAs(
    memberCookie,
    "POST",
    "/api/knowledge",
    lesson(),
  );
  return { response, submission: await response.json() };
}

beforeEach(async () => {
  await resetData();
  clearPermissionCache();
  await addTeam("other-team", "Other Team");
  await createUser({ email: "root@example.com", role: "admin" });
  memberCookie = await signedIn("member@example.com");
  leadCookie = await signedIn("lead@example.com");
  outsiderCookie = await signedIn("outsider@example.com");
  await setTeamMember("test-team", "lead@example.com", "admin");
  await setTeamMember("other-team", "outsider@example.com", "admin");
  productId = await tqxProductId();
});

describe("review routes", () => {
  it("turns a member's save into a proposal only that team's admin may decide", async () => {
    const { response, submission } = await proposedEntry();
    expect(response.status).toBe(202);
    expect(submission).toMatchObject({ proposed: true, status: "draft" });
    const proposalPath = `/api/review/proposals/${submission.proposal_id}`;

    expect((await requestAs(outsiderCookie, "GET", proposalPath)).status).toBe(
      403,
    );
    expect(
      (await requestAs(outsiderCookie, "POST", `${proposalPath}/accept`, {}))
        .status,
    ).toBe(403);
    expect(
      (await requestAs(memberCookie, "POST", `${proposalPath}/accept`, {}))
        .status,
    ).toBe(403);

    const queue = await (
      await requestAs(leadCookie, "GET", "/api/review/queue")
    ).json();
    expect(queue.proposals).toHaveLength(1);
    expect(queue.drafts).toHaveLength(0);
    const outsiderQueue = await (
      await requestAs(outsiderCookie, "GET", "/api/review/queue")
    ).json();
    expect(outsiderQueue.proposals).toHaveLength(0);

    const accepted = await requestAs(
      leadCookie,
      "POST",
      `${proposalPath}/accept`,
      {},
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).entry_status).toBe("approved");

    const inbox = await (
      await requestAs(memberCookie, "GET", "/api/me/notifications")
    ).json();
    expect(inbox[0]).toMatchObject({
      kind: "review_reply",
      ref: { proposal_id: submission.proposal_id },
    });
  });

  it("holds a member's edit as a proposal and writes an editor's directly", async () => {
    const saved = await (
      await requestAs(leadCookie, "POST", "/api/knowledge", lesson())
    ).json();
    expect(saved).toMatchObject({ proposed: false, status: "approved" });

    const proposed = await requestAs(
      memberCookie,
      "PATCH",
      `/api/knowledge/${saved.id}`,
      { resolution: "renew the lease on wake", note: "pinning did not hold" },
    );
    expect(proposed.status).toBe(202);
    const { proposal_id: proposalId } = await proposed.json();

    const live = await (
      await requestAs(memberCookie, "GET", `/api/knowledge/${saved.id}`)
    ).json();
    expect(live.resolution).toBe("pin the lease on the access point");
    const proposal = await (
      await requestAs(
        memberCookie,
        "GET",
        `/api/review/proposals/${proposalId}`,
      )
    ).json();
    expect(proposal).toMatchObject({
      note: "pinning did not hold",
      patch: { resolution: "renew the lease on wake" },
    });

    const direct = await requestAs(
      leadCookie,
      "PATCH",
      `/api/knowledge/${saved.id}`,
      { tags: ["network"] },
    );
    expect(direct.status).toBe(200);
    expect(await direct.json()).toMatchObject({ proposed: false, version: 2 });
  });

  it("counts what waits on a reviewer and what came back to a submitter", async () => {
    const { submission } = await proposedEntry();
    const proposalPath = `/api/review/proposals/${submission.proposal_id}`;
    const countFor = async (cookie: string) =>
      (await requestAs(cookie, "GET", "/api/review/count")).json();

    expect(await countFor(leadCookie)).toEqual({ waiting: 1, returned: 0 });
    expect(await countFor(outsiderCookie)).toEqual({ waiting: 0, returned: 0 });

    const noReason = await requestAs(
      leadCookie,
      "POST",
      `${proposalPath}/return`,
      { message: "  " },
    );
    expect(noReason.status).toBe(400);
    await requestAs(leadCookie, "POST", `${proposalPath}/return`, {
      message: "which access point?",
    });

    expect(await countFor(leadCookie)).toEqual({ waiting: 0, returned: 0 });
    expect(await countFor(memberCookie)).toEqual({ waiting: 0, returned: 1 });

    const mine = await (
      await requestAs(memberCookie, "GET", "/api/review/mine")
    ).json();
    expect(mine.map((p: { status: string }) => p.status)).toEqual(["returned"]);

    const resubmitted = await requestAs(
      memberCookie,
      "POST",
      `${proposalPath}/resubmit`,
      { note: "the office one" },
    );
    expect((await resubmitted.json()).status).toBe("open");
  });

  it("threads replies by side and keeps strangers out", async () => {
    const { submission } = await proposedEntry();
    const messagesPath = `/api/review/proposals/${submission.proposal_id}/messages`;

    const fromReviewer = await requestAs(leadCookie, "POST", messagesPath, {
      message: "is this on every model?",
    });
    expect(fromReviewer.status).toBe(201);
    expect((await fromReviewer.json()).direction).toBe("reviewer");

    const fromSubmitter = await requestAs(memberCookie, "POST", messagesPath, {
      message: "only the mc33",
    });
    expect((await fromSubmitter.json()).direction).toBe("submitter");

    expect(
      (
        await requestAs(outsiderCookie, "POST", messagesPath, {
          message: "let me in",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects with a reason and lets only the submitter withdraw", async () => {
    const first = await proposedEntry();
    const firstPath = `/api/review/proposals/${first.submission.proposal_id}`;

    expect(
      (await requestAs(leadCookie, "POST", `${firstPath}/withdraw`)).status,
    ).toBe(403);
    const withdrawn = await requestAs(
      memberCookie,
      "POST",
      `${firstPath}/withdraw`,
    );
    expect((await withdrawn.json()).status).toBe("withdrawn");

    const second = await proposedEntry();
    const rejected = await requestAs(
      leadCookie,
      "POST",
      `/api/review/proposals/${second.submission.proposal_id}/reject`,
      { message: "duplicate of the lease article" },
    );
    expect(await rejected.json()).toMatchObject({
      status: "rejected",
      entry_status: "rejected",
    });
  });

  it("answers 404 for a proposal that does not exist", async () => {
    const response = await requestAs(
      leadCookie,
      "GET",
      "/api/review/proposals/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status).toBe(404);
  });
});
