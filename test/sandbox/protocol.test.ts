import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  exitFrame,
  FrameReader,
  parseSandboxRequest,
  STREAM,
} from "../../packages/sandbox/src/protocol";

describe("sandbox frames", () => {
  it("reads frames however the bytes arrive", () => {
    const bytes = Buffer.concat([
      encodeFrame(STREAM.stdout, Buffer.from("hello")),
      encodeFrame(STREAM.stderr, Buffer.from("warn")),
      exitFrame({ exitCode: 0 }),
    ]);
    const reader = new FrameReader();
    const frames = [...bytes].flatMap((byte) =>
      reader.read(Buffer.from([byte])),
    );
    expect(
      frames.map((frame) => [frame.stream, frame.payload.toString()]),
    ).toEqual([
      [STREAM.stdout, "hello"],
      [STREAM.stderr, "warn"],
      [STREAM.exit, '{"exitCode":0}'],
    ]);
  });
});

describe("a sandbox request", () => {
  const VALID = { kind: "claude", args: ["--print"], env: { LANG: "C" } };

  it("is accepted with a known kind, string args and a string env", () => {
    expect(parseSandboxRequest(JSON.stringify(VALID))).toEqual(VALID);
    expect(
      parseSandboxRequest(
        JSON.stringify({ ...VALID, state: "users/_default" }),
      ),
    ).toEqual({ ...VALID, state: "users/_default" });
  });

  it("is refused in any other shape", () => {
    for (const invalid of [
      { ...VALID, kind: "tools" },
      { ...VALID, args: "--print" },
      { ...VALID, args: [1] },
      { ...VALID, env: { LANG: 1 } },
      { ...VALID, env: ["LANG=C"] },
      { ...VALID, state: 7 },
    ])
      expect(() => parseSandboxRequest(JSON.stringify(invalid))).toThrow();
    expect(() => parseSandboxRequest("not json")).toThrow();
  });
});
