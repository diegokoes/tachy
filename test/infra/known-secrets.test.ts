import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorText,
  forgetSecrets,
  log,
  maskSecrets,
  rememberSecret,
} from "@tachy/core/infra";

afterEach(forgetSecrets);

describe("known secrets", () => {
  it("masks a remembered value wherever it appears", () => {
    rememberSecret("s3ntinel-value-one");
    expect(maskSecrets("a s3ntinel-value-one b s3ntinel-value-one")).toBe(
      "a [SECRET] b [SECRET]",
    );
  });

  it("returns what it was given, so a lookup can be wrapped", () => {
    expect(rememberSecret("s3ntinel-value-one")).toBe("s3ntinel-value-one");
    expect(rememberSecret(undefined)).toBeUndefined();
  });

  it("leaves a value too short to be a secret alone", () => {
    rememberSecret("short");
    expect(maskSecrets("a short word")).toBe("a short word");
  });

  it("replaces the longer of two overlapping secrets whole", () => {
    rememberSecret("s3ntinel-value");
    rememberSecret("s3ntinel-value-extended");
    expect(maskSecrets("x s3ntinel-value-extended y")).toBe("x [SECRET] y");
  });

  it("masks the message of an error and the text of anything else", () => {
    rememberSecret("s3ntinel-value-one");
    expect(errorText(new Error("failed with s3ntinel-value-one"))).toBe(
      "failed with [SECRET]",
    );
    expect(errorText("s3ntinel-value-one")).toBe("[SECRET]");
  });

  it("masks every string a log line carries, nested ones included", () => {
    rememberSecret("s3ntinel-value-one");
    const written: string[] = [];
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => (written.push(String(chunk)), true));
    try {
      log("error", "leak_probe", {
        error: "git said s3ntinel-value-one",
        nested: { stack: ["at s3ntinel-value-one"] },
      });
    } finally {
      write.mockRestore();
    }
    const line = written.join("");
    expect(line).toContain("leak_probe");
    expect(line).toContain("git said [SECRET]");
    expect(line).not.toContain("s3ntinel-value-one");
  });
});
