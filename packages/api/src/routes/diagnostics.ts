import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  LOAD_SCRIPTS,
  cancelTestRun,
  getTestRun,
  inLoadWindow,
  listTestRuns,
  loadTargets,
  runSystemChecks,
  startTestRun,
} from "@tachy/core";
import { requireAdmin } from "../auth";
import { callerUserId } from "../authz";

/** The admin page's checks and load runs (DEPLOYMENT-ARCHITECTURE.md §11.3). */
export const tests = new Hono()
  .use("*", requireAdmin)

  .get("/checks", async (c) => c.json({ checks: await runSystemChecks() }))

  .get("/runs", async (c) =>
    c.json({
      runs: await listTestRuns(30),
      targets: loadTargets(),
      scripts: Object.entries(LOAD_SCRIPTS).map(([script, rules]) => ({
        script,
        any_time: rules.anyTime,
        dev_only: "devOnly" in rules && rules.devOnly,
      })),
      in_window: inLoadWindow(),
    }),
  )

  .post(
    "/runs",
    zValidator(
      "json",
      z.object({
        script: z.string(),
        target: z.string(),
        profile: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const { script, target, profile } = c.req.valid("json");
      return c.json(
        await startTestRun({
          script,
          target,
          profile: profile ?? null,
          requestedBy: await callerUserId(c),
        }),
        202,
      );
    },
  )

  .get("/runs/:id", async (c) => c.json(await getTestRun(c.req.param("id"))))

  .post("/runs/:id/cancel", async (c) =>
    c.json(await cancelTestRun(c.req.param("id"))),
  );
