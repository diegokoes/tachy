/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  probeTally,
  type Probe,
} from "../../packages/web/src/lib/admin/systemState.svelte";

const probe = (name: string, state: string): Probe => ({
  name,
  state,
  detail: "",
});

describe("probeTally", () => {
  it("has nothing to say before the probes have run", () => {
    expect(probeTally(null)).toBeNull();
  });

  /* A backend nobody configured is skipped, and a skip is not a pass: the
     counter reads "4/6 passing", not "5/6", when one of the six never ran. */
  it("counts each outcome apart, a skip as neither pass nor failure", () => {
    expect(
      probeTally([
        probe("database", "pass"),
        probe("embedding", "warn"),
        probe("vault", "pass"),
        probe("source eng-ado", "fail"),
        probe("agent copilot", "skip"),
      ]),
    ).toEqual({ total: 5, passing: 2, warning: 1, failing: 1, skipped: 1 });
  });
});
