import { describe, expect, it } from "vitest";
import {
  isProblemType,
  problemMessage,
  readProblem,
} from "../../packages/contract/src";

describe("reading a problem document", () => {
  it("reads the members and keeps the extensions", () => {
    expect(
      readProblem({
        title: "Conflict",
        status: 409,
        detail: "busy",
        turnId: "t",
      }),
    ).toEqual({ title: "Conflict", status: 409, detail: "busy", turnId: "t" });
  });

  it("drops a member of the wrong type", () => {
    expect(readProblem({ detail: { nested: true }, status: 400 })).toEqual({
      status: 400,
    });
    expect(readProblem({ detail: "kept", status: "400" })).toEqual({
      detail: "kept",
    });
  });

  it("finds no problem in a body that carries no member", () => {
    for (const body of [null, undefined, "text", 3, [], {}, { error: "old" }])
      expect(readProblem(body)).toBeUndefined();
  });

  it("prefers the detail to the title as the sentence to show", () => {
    expect(problemMessage({ title: "Conflict", detail: "busy" })).toBe("busy");
    expect(problemMessage({ title: "Conflict" })).toBe("conflict");
    expect(problemMessage(undefined)).toBeUndefined();
  });

  it("tells a minted type from any other", () => {
    const minted = { type: "/problems/turn-in-progress" };
    expect(isProblemType(minted, "turn-in-progress")).toBe(true);
    expect(isProblemType({ type: "about:blank" }, "turn-in-progress")).toBe(
      false,
    );
    expect(isProblemType(undefined, "turn-in-progress")).toBe(false);
  });
});
