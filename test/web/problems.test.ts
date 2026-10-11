import { describe, expect, it } from "vitest";
import { ApiError, readError } from "../../packages/web/src/problems";

describe("what a refused response says", () => {
  it("reads a problem's detail and keeps the problem", async () => {
    const refusal = await readError(
      Response.json(
        { title: "Forbidden", status: 403, detail: "app admin role required" },
        { status: 403 },
      ),
    );
    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal.status).toBe(403);
    expect(refusal.message).toBe("app admin role required");
    expect(refusal.problem?.title).toBe("Forbidden");
  });

  it("falls back to the title when there is no detail", async () => {
    const refusal = await readError(
      Response.json({ title: "Bad Gateway", status: 502 }, { status: 502 }),
    );
    expect(refusal.message).toBe("Bad Gateway");
  });

  it("lets the status speak for a body that is not a problem", async () => {
    const page = new Response("<html>502</html>", {
      status: 502,
      statusText: "Bad Gateway",
    });
    expect((await readError(page)).message).toBe("Bad Gateway");

    const bare = new Response("", { status: 503 });
    const refusal = await readError(bare);
    expect(refusal.message).toBe("request failed (503)");
    expect(refusal.problem).toBeUndefined();
  });
});
