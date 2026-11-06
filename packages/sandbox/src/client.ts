/** A sandbox opened through the launcher's socket, handled like a child process. */
import { EventEmitter } from "node:events";
import { connect, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import {
  encodeFrame,
  FrameReader,
  STREAM,
  type Frame,
  type SandboxExit,
  type SandboxRequest,
} from "./protocol";

export interface SandboxConnection {
  socketPath: string;
  onStderr?: (text: string) => void;
}

/** The sandbox's stdin and stdout. Emits `exit` once, `error` for a launcher refusal. */
export class SandboxProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  private exited = false;
  private readonly launcher: Socket;
  private readonly frames = new FrameReader();

  constructor(
    request: SandboxRequest,
    private readonly connection: SandboxConnection,
  ) {
    super();
    this.launcher = connect(connection.socketPath);
    this.launcher.write(`${JSON.stringify(request)}\n`);
    this.stdin.on("data", (chunk: Buffer) =>
      this.launcher.write(encodeFrame(STREAM.stdin, chunk)),
    );
    this.stdin.on("end", () =>
      this.launcher.write(encodeFrame(STREAM.stdinEnd, Buffer.alloc(0))),
    );
    this.launcher.on("data", (chunk: Buffer) => {
      for (const frame of this.frames.read(chunk)) this.receive(frame);
    });
    this.launcher.on("error", (error) => this.emit("error", error));
    this.launcher.on("close", () => this.finish(null));
  }

  kill(): boolean {
    this.killed = true;
    this.launcher.destroy();
    return true;
  }

  private receive(frame: Frame): void {
    if (frame.stream === STREAM.stdout) this.stdout.write(frame.payload);
    else if (frame.stream === STREAM.stderr)
      this.connection.onStderr?.(frame.payload.toString());
    else if (frame.stream === STREAM.exit) {
      const exit = JSON.parse(frame.payload.toString()) as SandboxExit;
      if (exit.error) this.emit("error", new Error(exit.error));
      this.finish(exit.exitCode);
      this.launcher.destroy();
    }
  }

  private finish(exitCode: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = exitCode;
    this.stdout.end();
    this.emit("exit", exitCode, exitCode === null ? "SIGKILL" : null);
  }
}

export const openSandbox = (
  request: SandboxRequest,
  connection: SandboxConnection,
): SandboxProcess => new SandboxProcess(request, connection);
