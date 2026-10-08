import { describe, expect, it } from "vitest";
import { parseCodeScope, projectToken } from "../../packages/contract/src";

describe("projectToken", () => {
  it("makes one word of a key with spaces in it", () => {
    expect(projectToken("Portal Mobile")).toBe("Portal-Mobile");
    expect(projectToken("  Portal   Mobile ")).toBe("Portal-Mobile");
    expect(projectToken("owner/repo")).toBe("owner/repo");
  });
});

describe("parseCodeScope", () => {
  it("takes repos and projects out of the question", () => {
    expect(
      parseCodeScope("@portal-api @Portal-Mobile/ why does login loop?"),
    ).toEqual({
      repos: ["portal-api"],
      projects: ["Portal-Mobile"],
      question: "why does login loop?",
    });
  });

  it("reads a scope word wherever it is typed, once each", () => {
    expect(parseCodeScope("where is retry @api handled @web @api")).toEqual({
      repos: ["api", "web"],
      projects: [],
      question: "where is retry handled",
    });
  });

  it("leaves an address in the question alone", () => {
    expect(parseCodeScope("who mails ops@example.com on failure")).toEqual({
      repos: [],
      projects: [],
      question: "who mails ops@example.com on failure",
    });
  });

  it("is empty for an empty line", () => {
    expect(parseCodeScope("  ")).toEqual({
      repos: [],
      projects: [],
      question: "",
    });
  });
});
