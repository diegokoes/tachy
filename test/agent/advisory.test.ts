/** One advisory call with the model stubbed: what its prompt is scrubbed by. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "@tachy/core/access";
import { setCredential } from "@tachy/core/config";
import { runAdvisory } from "../../packages/agent/src/advisory";
import { completeOnce } from "../../packages/agent/src/complete";
import { resetData, sql } from "../database";
import { enableVault } from "../vault";

vi.mock("../../packages/agent/src/complete", () => ({
  completeOnce: vi.fn(),
}));

afterAll(() => sql.end());

const ask = (redact?: boolean) =>
  runAdvisory(
    {
      system: "Answer.",
      prompt: (scrub) => scrub("Reported by ana@dock.example."),
      redact,
      tier: "cheap",
      timeoutMs: 1_000,
      mode: "review",
    },
    {},
    null,
  );

const promptSent = () => vi.mocked(completeOnce).mock.calls.at(-1)![0];

beforeEach(async () => {
  await resetData();
  enableVault();
  const admin = await createUser({ email: "admin@x.test", role: "admin" });
  await setCredential(
    admin.id,
    "global",
    undefined,
    "anthropic_api_key",
    "sk-ant-api03-advisory",
  );
  vi.mocked(completeOnce)
    .mockReset()
    .mockResolvedValue({
      text: "ok",
      costUsd: 0,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    });
});

describe("runAdvisory", () => {
  it("sends the prompt as written with redaction off", async () => {
    await ask();
    expect(promptSent()).toBe("Reported by ana@dock.example.");
  });

  it("scrubs the prompt for a caller whose connection redacts", async () => {
    await ask(true);
    expect(promptSent()).toBe("Reported by [EMAIL_1].");
  });
});
