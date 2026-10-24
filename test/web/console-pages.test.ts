/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { hasIssueList } from "../../packages/web/src/admin/pages";

describe("console issue lists", () => {
  it("are asked for on the pages the endpoint answers", () => {
    expect(hasIssueList("integrations", { admin: false })).toBe(true);
    expect(hasIssueList("access", { admin: false })).toBe(true);
    expect(hasIssueList("flows", { admin: true })).toBe(false);
  });

  it("are asked for on jobs and system by app admins only", () => {
    expect(hasIssueList("workers", { admin: true })).toBe(true);
    expect(hasIssueList("system", { admin: false })).toBe(false);
  });
});
