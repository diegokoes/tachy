/**
 * The launcher's wire format. A client sends one JSON request line, then its
 * stdin as frames and a stdin-end frame. The launcher answers in Docker's
 * attach framing, with an exit frame last. A connection that closes is a
 * client gone, whose container is removed.
 */
export const SANDBOX_KINDS = ["claude"] as const;
export type SandboxKind = (typeof SANDBOX_KINDS)[number];

export interface SandboxRequest {
  kind: SandboxKind;
  args: string[];
  env: Record<string, string>;
  /** The person's agent state as `users/<id>` in the state volume; absent for a one-shot. */
  state?: string;
}

export interface SandboxExit {
  /** Null when the container never ran or was killed. */
  exitCode: number | null;
  error?: string;
}

/** Docker's attach stream ids, then the two this protocol adds. */
export const STREAM = {
  stdin: 0,
  stdout: 1,
  stderr: 2,
  exit: 3,
  stdinEnd: 4,
} as const;

const HEADER_BYTES = 8;
const SIZE_OFFSET = 4;

export function encodeFrame(stream: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(stream, 0);
  header.writeUInt32BE(payload.length, SIZE_OFFSET);
  return Buffer.concat([header, payload]);
}

export const exitFrame = (exit: SandboxExit): Buffer =>
  encodeFrame(STREAM.exit, Buffer.from(JSON.stringify(exit)));

export interface Frame {
  stream: number;
  payload: Buffer;
}

/** Frames out of a byte stream that may split or join them anywhere. */
export class FrameReader {
  private pending = Buffer.alloc(0);

  read(chunk: Buffer): Frame[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Frame[] = [];
    while (this.pending.length >= HEADER_BYTES) {
      const end = HEADER_BYTES + this.pending.readUInt32BE(SIZE_OFFSET);
      if (this.pending.length < end) break;
      frames.push({
        stream: this.pending.readUInt8(0),
        payload: this.pending.subarray(HEADER_BYTES, end),
      });
      this.pending = this.pending.subarray(end);
    }
    return frames;
  }
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

/** A request line as the launcher accepts it; throws on anything else. */
export function parseSandboxRequest(line: string): SandboxRequest {
  const value = JSON.parse(line) as Record<string, unknown>;
  if (!SANDBOX_KINDS.includes(value.kind as SandboxKind))
    throw new Error(`unknown sandbox kind '${String(value.kind)}'`);
  if (
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === "string")
  )
    throw new Error("args must be a list of strings");
  if (!isStringRecord(value.env))
    throw new Error("env must be an object of strings");
  if (value.state !== undefined && typeof value.state !== "string")
    throw new Error("state must be a string");
  return {
    kind: value.kind as SandboxKind,
    args: value.args,
    env: value.env,
    ...(value.state === undefined ? {} : { state: value.state }),
  };
}
