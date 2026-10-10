import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_INVITED } from "@tachy/contract";
import {
  initSession,
  session,
} from "../../packages/web/src/access/session.svelte";

/** What the three calls a boot makes are answered with. */
function answers(me: Response) {
  const byPath: Record<string, () => Response> = {
    "/auth/config": () =>
      Response.json({
        authMode: "sso",
        sso: true,
        passwordLogin: false,
        envBadge: null,
      }),
    "/api/setup/status": () => Response.json({ bootstrapped: true }),
    "/auth/me": () => me,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => byPath[path]()),
  );
}

const refused = () =>
  Response.json(
    { error: "not added", code: NOT_INVITED, email: "stranger@example.com" },
    { status: 403 },
  );

afterEach(() => vi.unstubAllGlobals());

describe("what the app knows once it has booted", () => {
  it("keeps the refusal of a sign-in nobody added an account for", async () => {
    answers(refused());
    await initSession();
    expect(session.me).toBeNull();
    expect(session.uninvited).toEqual({ email: "stranger@example.com" });
    expect(session.config?.sso).toBe(true);
    expect(session.loading).toBe(false);
  });

  it("has nobody refused when someone is signed in", async () => {
    answers(
      Response.json({ email: "sam@example.com", role: "member", via: "sso" }),
    );
    await initSession();
    expect(session.me?.email).toBe("sam@example.com");
    expect(session.uninvited).toBeNull();
  });

  it("reads an ordinary 401 as signed out, not as refused", async () => {
    answers(Response.json({ error: "unauthenticated" }, { status: 401 }));
    await initSession();
    expect(session.me).toBeNull();
    expect(session.uninvited).toBeNull();
  });

  it("is signed out, not broken, when the answer is not JSON", async () => {
    answers(new Response("<html>bad gateway</html>", { status: 502 }));
    await initSession();
    expect(session.me).toBeNull();
    expect(session.uninvited).toBeNull();
    expect(session.unreachable).toBe(false);
  });

  it("forgets a refusal when the api can no longer be reached", async () => {
    answers(refused());
    await initSession();
    expect(session.uninvited).not.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await initSession();
    expect(session.uninvited).toBeNull();
    expect(session.unreachable).toBe(true);
    expect(session.me).toBeNull();
  });
});
