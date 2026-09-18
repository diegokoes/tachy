import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  EMBEDDING_SPEC,
  EmbedderUnavailable,
  type EmbedKind,
} from "@tachy/core";

export interface InternalOptions {
  secret: string;
  embed: (
    kind: EmbedKind,
    texts: string[],
    caller: string,
    priority?: "normal" | "low",
  ) => Promise<number[][]>;
}

const MAX_TEXT = EMBEDDING_SPEC.maxChars + 256;

const body = z.object({
  kind: z.enum(["query", "passage"]),
  texts: z.array(z.string().max(MAX_TEXT)).min(1).max(256),
});

const logBody = z.object({
  lines: z.array(z.string().max(16_000)).min(1).max(100),
});

const sameSecret = (given: string, want: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * For the MCP children this process spawns, and nobody else: never routed by
 * the proxy, and every call needs the per-boot secret only the children get.
 *
 * `/embed` is text in, vectors out; it reads and writes nothing. `/log` exists
 * because Claude Code does not pass its MCP servers' stderr on, so a child's
 * log lines would otherwise never reach the container log.
 */
export function internalRoutes(opts: InternalOptions) {
  const authorized = (auth: string | undefined) =>
    sameSecret((auth ?? "").replace(/^Bearer /, ""), opts.secret);

  return new Hono()
    .post(
      "/embed",
      bodyLimit({ maxSize: 256 * (MAX_TEXT * 4 + 16) }),
      async (c) => {
        if (!authorized(c.req.header("authorization")))
          return c.json({ error: "unauthorized" }, 401);
        const parsed = body.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ error: "validation failed" }, 400);
        const caller = (c.req.header("x-tachy-caller") ?? "remote").slice(
          0,
          80,
        );
        try {
          const vectors = await opts.embed(
            parsed.data.kind,
            parsed.data.texts,
            `remote:${caller}`,
            c.req.header("x-tachy-priority") === "low" ? "low" : "normal",
          );
          return c.json({ vectors });
        } catch (err) {
          if (err instanceof EmbedderUnavailable) {
            c.header("Retry-After", "2");
            return c.json({ error: err.message }, 503);
          }
          throw err;
        }
      },
    )
    .post("/log", bodyLimit({ maxSize: 2_000_000 }), async (c) => {
      if (!authorized(c.req.header("authorization")))
        return c.json({ error: "unauthorized" }, 401);
      const parsed = logBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "validation failed" }, 400);
      for (const line of parsed.data.lines) {
        let fields: unknown;
        try {
          fields = JSON.parse(line);
        } catch {
          continue;
        }
        if (fields && typeof fields === "object" && !Array.isArray(fields))
          process.stderr.write(
            JSON.stringify({ ...fields, source: "mcp" }) + "\n",
          );
      }
      return c.body(null, 204);
    });
}
