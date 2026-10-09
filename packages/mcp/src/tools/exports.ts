/** Turning a result set into a file the user can download. */
import { z } from "zod";
import { resolveCurrentUserId, userSoleTeamId } from "@tachy/core/access";
import {
  getArtifactBySlug,
  createOutput,
  renderTable,
  tableColumnSchema,
} from "@tachy/core/exports";
import { parseDateFormat, outputFilename, TABLE_FORMATS } from "@tachy/core";
import { badInput } from "@tachy/core/infra";
import { recordAudit } from "@tachy/core/audit";
import { tool } from "../server";
import { out } from "../results";
import { mcpActor } from "../permissions";

tool(
  "export_table",
  {
    description:
      "Generate a downloadable spreadsheet (xlsx) or CSV from rows you produce, and return a download link. When the user attached an artifact that declares output columns, pass its artifact_slug and fill EXACTLY those columns - extra columns, renamed keys or missing required values are rejected with the reason, so fix the rows and call again. Without an artifact, pass columns yourself. Never print the table into the chat and never restate the rows afterwards: the user gets the file. The result carries only a descriptor (id, filename, size, url), never the file contents.",
    inputSchema: {
      artifact_slug: z
        .string()
        .optional()
        .describe(
          "Slug of an artifact whose spec.output declares the columns and format. Takes precedence over columns.",
        ),
      format: z
        .enum(TABLE_FORMATS)
        .optional()
        .describe("Overrides the artifact's format. Defaults to xlsx."),
      sheet: z.string().optional(),
      filename: z
        .string()
        .optional()
        .describe("Supports {date} and {slug} placeholders."),
      columns: z
        .array(tableColumnSchema)
        .optional()
        .describe("Required when artifact_slug is not given."),
      rows: z
        .array(z.record(z.string(), z.unknown()))
        .describe(
          "One object per row, keyed by column key. Dates as ISO strings and numbers as numbers, so the cells are typed and Excel sorts them properly. Leave an optional column null rather than inventing a value.",
        ),
    },
    // Not readOnlyHint: createOutput inserts the rendered bytes as a row. The
    // tool is in READ_TOOLS since a table the user asked for is no change to
    // the library, but a client running it unattended is told it writes.
    annotations: { readOnlyHint: false },
  },
  async ({ artifact_slug, format, sheet, filename, columns, rows }) => {
    const userId = await resolveCurrentUserId();
    const artifact = artifact_slug
      ? await getArtifactBySlug(artifact_slug, {
          userId: userId ?? undefined,
          teamId: userId
            ? ((await userSoleTeamId(userId)) ?? undefined)
            : undefined,
        })
      : undefined;

    if (artifact_slug && !artifact)
      throw badInput(`no artifact '${artifact_slug}' is visible to you`);

    const output = artifact?.spec?.output;
    const spec = output ?? {
      format: format ?? "xlsx",
      sheet,
      filename,
      columns: columns ?? [],
    };
    if (!spec.columns.length)
      throw badInput(
        "no columns: pass columns, or an artifact_slug whose spec declares them",
      );

    const chosen = format ?? spec.format;
    const rendered = renderTable({
      format: chosen,
      sheet: sheet ?? spec.sheet,
      columns: spec.columns,
      rows,
      dateFormat: parseDateFormat(process.env.TACHY_DATE_FORMAT),
    });

    const meta = await createOutput({
      userId,
      artifactId: artifact?.id ?? null,
      utility: "export_table",
      filename: outputFilename(
        { filename: filename ?? spec.filename, format: chosen },
        artifact_slug ?? "export",
      ),
      mime: rendered.mime,
      bytes: rendered.bytes,
      meta: { rows: rows.length, columns: spec.columns.length },
    });
    await recordAudit({
      actor: await mcpActor(),
      action: "export",
      target: meta.filename,
      detail: { rows: rows.length, bytes: meta.byte_size },
    });

    return out({
      output: {
        id: meta.id,
        filename: meta.filename,
        mime: meta.mime,
        byte_size: meta.byte_size,
        rows: rows.length,
        columns: spec.columns.length,
        url: `/api/outputs/${meta.id}/download`,
        expires_at: meta.expires_at,
      },
      next: "The file is ready and the user sees a download card. Say one line about what it contains - do not restate the rows.",
    });
  },
);
