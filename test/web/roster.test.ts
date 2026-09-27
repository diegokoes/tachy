/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  membersOf,
  signIn,
  teamsOf,
  type Membership,
} from "../../packages/web/src/lib/admin/roster.svelte";
import type { UserRow } from "../../packages/web/src/lib/admin/rows";

const user = (p: Partial<UserRow> = {}): UserRow => ({
  id: "u1",
  email: "a@example.com",
  display_name: null,
  role: "member",
  disabled: false,
  has_password: true,
  service_account: false,
  password_login_allowed: false,
  created_at: "2026-01-01",
  ...p,
});

describe("signIn", () => {
  describe("without SSO", () => {
    it("lets a password account in, and offers nobody SSO", () => {
      expect(signIn(user(), false)).toEqual({ password: true, sso: false });
    });

    it("leaves an account with no password unable to sign in at all", () => {
      expect(signIn(user({ has_password: false }), false)).toEqual({
        password: false,
        sso: false,
      });
    });
  });

  describe("under SSO", () => {
    /* Holding a hash is not the same as being able to use it: once SSO is
       configured, password login is off unless the account is allowed one. */
    it("ignores a password nobody is allowed to use", () => {
      expect(signIn(user(), true)).toEqual({ password: false, sso: true });
    });

    it("honours a break-glass account's password", () => {
      expect(signIn(user({ password_login_allowed: true }), true)).toEqual({
        password: true,
        sso: true,
      });
    });

    it("does not claim SSO for a service account, which uses a token", () => {
      expect(signIn(user({ service_account: true }), true)).toEqual({
        password: false,
        sso: false,
      });
    });

    it("still needs a password to exist before allowing one", () => {
      expect(
        signIn(
          user({ has_password: false, password_login_allowed: true }),
          true,
        ),
      ).toMatchObject({ password: false });
    });
  });

  /* A team admin cannot read the runtime block, so SSO is unknown to them.
     Unknown is treated as "not configured" for the password column; the
     honest reading, since a password that works today keeps working. */
  it("treats an unknown SSO setting as not configured", () => {
    expect(signIn(user(), null)).toEqual({ password: true, sso: false });
  });
});

describe("membership lookups", () => {
  const ms: Membership[] = [
    {
      user_id: "u1",
      team_slug: "plat",
      team_name: "Platform",
      team_role: "admin",
    },
    {
      user_id: "u2",
      team_slug: "plat",
      team_name: "Platform",
      team_role: "member",
    },
    {
      user_id: "u1",
      team_slug: "sup",
      team_name: "Support",
      team_role: "member",
    },
  ];

  it("finds every team one person is in", () => {
    expect(teamsOf(user({ id: "u1" }), ms).map((m) => m.team_slug)).toEqual([
      "plat",
      "sup",
    ]);
  });

  it("finds everyone in one team", () => {
    expect(membersOf("plat", ms).map((m) => m.user_id)).toEqual(["u1", "u2"]);
  });

  it("has nothing to report for a team nobody is in", () => {
    expect(membersOf("ghost", ms)).toEqual([]);
  });
});
