import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

let adminCookie = "";
let userCookie = "";

function as(cookie: string, path: string, method: string, body?: unknown) {
  return app.request(path, {
    ...(body === undefined ? {} : json(body)),
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Cookie: cookie,
    },
  });
}

beforeEach(async () => {
  await resetData();
  await createUser({
    email: "admin@example.com",
    password: "a-long-password",
    role: "admin",
  });
  await createUser({
    email: "member@example.com",
    password: "a-long-password",
    role: "member",
  });
  adminCookie = await loginCookie(app, "admin@example.com", "a-long-password");
  userCookie = await loginCookie(app, "member@example.com", "a-long-password");
});

describe("report routes", () => {
  it("lets a member file a report and admins reply, notifying the reporter", async () => {
    const filed = await as(userCookie, "/api/reports", "POST", {
      type: "bug",
      title: "export breaks",
      body: "clicked export, nothing happened",
    });
    expect(filed.status).toBe(201);
    const report = await filed.json();
    expect(report.type).toBe("bug");

    // The member sees their own report.
    const mine = await (await as(userCookie, "/api/reports", "GET")).json();
    expect(mine).toHaveLength(1);

    // A member cannot reach the admin queue.
    const denied = await as(userCookie, "/api/reports/all", "GET");
    expect(denied.status).toBe(403);
    const adminDenied = await as(
      userCookie,
      `/api/reports/${report.id}`,
      "GET",
    );
    expect(adminDenied.status).toBe(403);

    // The admin lists, replies, and moves status.
    const queue = await (
      await as(adminCookie, "/api/reports/all", "GET")
    ).json();
    expect(queue).toHaveLength(1);

    const reply = await as(
      adminCookie,
      `/api/reports/${report.id}/reply`,
      "POST",
      { body: "fixed in the next release, thank you!" },
    );
    expect(reply.status).toBe(201);

    // The reporter now has a notification carrying the reply.
    const inbox = await (
      await as(userCookie, "/api/me/notifications", "GET")
    ).json();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("report_reply");
    expect(inbox[0].body_text).toContain("next release");
    expect(inbox[0].ref.report_id).toBe(report.id);

    const moved = await as(
      adminCookie,
      `/api/reports/${report.id}/status`,
      "PUT",
      { status: "resolved" },
    );
    expect(moved.status).toBe(200);
    expect((await moved.json()).status).toBe("resolved");
  });

  it("rejects an unknown report type", async () => {
    const bad = await as(userCookie, "/api/reports", "POST", {
      type: "rant",
      body: "grr",
    });
    expect(bad.status).toBe(400);
  });

  it("marks a notification read for its owner only", async () => {
    const filed = await (
      await as(userCookie, "/api/reports", "POST", {
        type: "feature",
        body: "x",
      })
    ).json();
    await as(adminCookie, `/api/reports/${filed.id}/reply`, "POST", {
      body: "noted",
    });
    const inbox = await (
      await as(userCookie, "/api/me/notifications", "GET")
    ).json();
    const id = inbox[0].id;

    // The admin cannot read the member's notification away.
    await as(adminCookie, "/api/me/notifications/read", "POST", { ids: [id] });
    const stillUnread = await (
      await as(userCookie, "/api/me/notifications", "GET")
    ).json();
    expect(stillUnread[0].read_at).toBeNull();

    await as(userCookie, "/api/me/notifications/read", "POST", { ids: [id] });
    const read = await (
      await as(userCookie, "/api/me/notifications", "GET")
    ).json();
    expect(read[0].read_at).not.toBeNull();
  });
});
