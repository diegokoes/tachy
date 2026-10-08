import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { AppError, env } from "@tachy/core/infra";
import {
  gateUserId,
  requireAnyTeamAdmin,
  requireGlobalAdmin,
} from "../../packages/mcp/src/permissions";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

describe("the chat tools' gate, when the session names no user", () => {
  beforeAll(resetData);
  afterEach(() => {
    env.actorRole = undefined;
  });

  it("checks nothing while the deployment has no admin", async () => {
    expect(await gateUserId()).toBeNull();
    await expect(requireGlobalAdmin()).resolves.toBeUndefined();
  });

  it("refuses once an admin exists", async () => {
    await createUser({
      email: "root@example.com",
      password: "admin-password",
      role: "admin",
    });
    await expect(gateUserId()).rejects.toThrow(AppError);
    await expect(requireAnyTeamAdmin()).rejects.toThrow(/no user is attached/);
  });

  it("lets through the turn of an app admin with no user row", async () => {
    env.actorRole = "admin";
    expect(await gateUserId()).toBeNull();
    await expect(requireGlobalAdmin()).resolves.toBeUndefined();
  });
});
