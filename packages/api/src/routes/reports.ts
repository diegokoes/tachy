import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  createReport,
  listMyReports,
  listReports,
  getReport,
  addReportMessage,
  setReportStatus,
  notify,
  REPORT_TYPES,
  REPORT_STATUSES,
  type ReportReview,
} from "@tachy/core";
import { requireAdmin } from "../auth";
import { requireCaller, callerScope } from "../authz";
import { reviewReport } from "../report-review";

const reviewSchema = z.object({
  type: z.enum(REPORT_TYPES),
  body: z.string().min(1),
});

const reviewResultSchema = z.object({
  available: z.boolean(),
  ok: z.boolean(),
  suggestions: z.array(z.string()),
});

const submitSchema = z.object({
  type: z.enum(REPORT_TYPES),
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(20_000),
  context: z.record(z.string(), z.unknown()).optional(),
  review: reviewResultSchema.optional(),
});

/**
 * User-facing and admin report endpoints in one router. The admin queue lives at
 * `/reports/all` rather than `/reports` so it does not shadow the member's own
 * list, which is what `GET /reports` is.
 */
export const reports = new Hono()

  /** The advisory the form asks for before submitting. */
  .post("/review", zValidator("json", reviewSchema), async (c) => {
    const userId = await requireCaller(c);
    const ctx = await callerScope(c);
    const { type, body } = c.req.valid("json");
    return c.json(await reviewReport(body, type, ctx, userId));
  })

  .post("/", zValidator("json", submitSchema), async (c) => {
    const userId = await requireCaller(c);
    const { type, title, body, context, review } = c.req.valid("json");
    const row = await createReport({
      reporterId: userId,
      type,
      title: title ?? null,
      body,
      context,
      aiReview: (review as ReportReview | undefined) ?? null,
    });
    return c.json(row, 201);
  })

  .get("/", async (c) => {
    const userId = await requireCaller(c);
    return c.json(await listMyReports(userId));
  })

  /* ── Admin queue ──────────────────────────────────────────────────────── */

  .get(
    "/all",
    requireAdmin,
    zValidator(
      "query",
      z.object({ status: z.enum(REPORT_STATUSES).optional() }),
    ),
    async (c) =>
      c.json(await listReports({ status: c.req.valid("query").status })),
  )

  .get("/:id", requireAdmin, async (c) =>
    c.json(await getReport(c.req.param("id")!)),
  )

  .post(
    "/:id/reply",
    requireAdmin,
    zValidator("json", z.object({ body: z.string().min(1).max(20_000) })),
    async (c) => {
      const adminId = await requireCaller(c);
      const id = c.req.param("id")!;
      const report = await getReport(id);
      const message = await addReportMessage({
        reportId: id,
        authorId: adminId,
        direction: "admin",
        body: c.req.valid("json").body,
      });
      // The reporter may have been deleted since; only a live account has an
      // inbox to reach.
      if (report.reporter_id)
        await notify({
          userId: report.reporter_id,
          kind: "report_reply",
          title:
            report.type === "bug"
              ? "An admin replied to your bug report"
              : "An admin replied to your feature request",
          body: message.body_text,
          ref: { report_id: id },
        });
      return c.json(message, 201);
    },
  )

  .put(
    "/:id/status",
    requireAdmin,
    zValidator("json", z.object({ status: z.enum(REPORT_STATUSES) })),
    async (c) =>
      c.json(
        await setReportStatus(c.req.param("id")!, c.req.valid("json").status),
      ),
  );
