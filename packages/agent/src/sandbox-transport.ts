/** MCP over a sandbox's stdin and stdout, framed as the SDK's stdio transport frames it. */
import {
  ReadBuffer,
  serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SandboxProcess } from "@tachy/sandbox";

/** What a closed sandbox gets to exit by itself, as the SDK gives a child, before it is removed. */
const EXIT_GRACE_MS = 2_000;

export class SandboxTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly incoming = new ReadBuffer();

  constructor(private readonly sandbox: SandboxProcess) {}

  async start(): Promise<void> {
    this.sandbox.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.sandbox.on("error", (error: Error) => this.onerror?.(error));
    this.sandbox.once("exit", () => this.onclose?.());
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((sent) => {
      if (this.sandbox.stdin.write(serializeMessage(message))) sent();
      else this.sandbox.stdin.once("drain", sent);
    });
  }

  async close(): Promise<void> {
    if (this.sandbox.exited) return;
    const exited = new Promise((done) => this.sandbox.once("exit", done));
    this.sandbox.stdin.end();
    const removal = setTimeout(() => this.sandbox.kill(), EXIT_GRACE_MS);
    await exited;
    clearTimeout(removal);
  }

  private receive(chunk: Buffer): void {
    try {
      this.incoming.append(chunk);
    } catch (overflow) {
      this.onerror?.(overflow as Error);
      this.sandbox.kill();
      return;
    }
    for (;;) {
      try {
        const message = this.incoming.readMessage();
        if (!message) return;
        this.onmessage?.(message);
      } catch (malformed) {
        this.onerror?.(malformed as Error);
      }
    }
  }
}
