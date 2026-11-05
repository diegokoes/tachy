import { basename } from "node:path";
import { Hono } from "hono";
import { validate } from "../validation";
import { z } from "zod";
import { fileFamily, uploadLimitBytes } from "@tachy/core";
import { uploadLimits } from "@tachy/core/chat";
import { extractFile, inspectFile } from "@tachy/core/files";
import { badInput, notFound, sql } from "@tachy/core/infra";
import {
  listReferenceDocs,
  getReferenceDoc,
  searchReferenceDocs,
  saveReferenceDoc,
  updateReferenceDoc,
  revertReferenceDoc,
  referenceDocLineage,
} from "@tachy/core/reference";
import {
  listRevisions,
  getRevision,
  countView,
  backlinks,
  outboundLinks,
  viewStats,
  viewHistory,
  getDocFile,
  keepsOriginal,
  saveLibraryFile,
} from "@tachy/core/library";
import { referenceStatusSchema } from "@tachy/core/knowledge";
import {
  resolveComponentFilter,
  resolveCustomerFilter,
} from "@tachy/core/catalog";
import { assertScopeEditor, callerActor, callerUserId } from "../authz";
import { csv } from "../query";
import { contentDisposition, INERT_HEADERS } from "../downloads";
import { problem } from "../problems";
import { requestLimitBytes, tooLarge } from "../upload-limit";

/** The filing fields an uploaded file's doc takes, beside the file itself. */
const uploadFilingSchema = z.object({
  title: z.string().min(1).optional(),
  productId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  component: z.string().min(1).optional(),
  customerSlug: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
});

/** The name a doc takes from its file when none is given: the name without its extension. */
const titleOf = (filename: string) =>
  filename.replace(/\.[^.]+$/, "") || filename;

const referenceInputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  productId: z.string().optional(),
  teamId: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: referenceStatusSchema.optional(),
  docVersion: z.string().optional(),
  supersedes: z.string().optional(),
  component: z.string().nullable().optional(),
  customerSlug: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
});

const referenceUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  status: referenceStatusSchema.optional(),
  source: z.string().nullable().optional(),
  docVersion: z.string().nullable().optional(),
  component: z.string().nullable().optional(),
  customerSlug: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  expectedVersion: z.number().int().optional(),
});

type QueryCtx = { req: { query(key: string): string | undefined } };

async function listFilters(c: QueryCtx) {
  const tags = csv(c.req.query("tags"));
  const component = c.req.query("component");
  const productId = c.req.query("product_id");
  const customerSlug = c.req.query("customer");
  // Component slugs resolve within a product, so the pair is required - same
  // rule the knowledge route follows.
  const filter =
    component && productId
      ? await resolveComponentFilter(productId, component)
      : undefined;
  const merged = [...(tags ?? []), ...(filter?.extraTags ?? [])];
  return {
    productId,
    teamId: c.req.query("team_id"),
    tags: merged.length ? merged : undefined,
    componentId: filter?.componentId,
    componentTags: filter?.componentTags,
    ...(await resolveCustomerFilter(customerSlug, c.req.query("unit"))),
    docVersion: c.req.query("doc_version"),
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  };
}

/** Which shelf a list or search is narrowed to; anything else is ignored. */
function shelf(c: QueryCtx) {
  const kind = c.req.query("kind");
  return kind === "reference" || kind === "wiki" || kind === "any"
    ? kind
    : undefined;
}

export const reference = new Hono()
  .get("/search", async (c) => {
    const kind = shelf(c);
    const rows = await searchReferenceDocs(c.req.query("q") ?? "", {
      ...(await listFilters(c)),
      kind: kind === "any" ? undefined : kind,
    });
    return c.json(rows);
  })
  .get("/:id/lineage", async (c) =>
    c.json(await referenceDocLineage(c.req.param("id"))),
  )
  .get("/:id/revisions", async (c) =>
    c.json(await listRevisions({ docId: c.req.param("id") })),
  )
  .get("/:id/revisions/:version", async (c) =>
    c.json(
      await getRevision(
        { docId: c.req.param("id") },
        Number(c.req.param("version")),
      ),
    ),
  )
  .post("/:id/revert/:version", async (c) => {
    const id = c.req.param("id");
    const doc = await getReferenceDoc(id);
    await assertScopeEditor(c, {
      productId: doc.product_id,
      teamId: doc.team_id,
    });
    return c.json(
      await revertReferenceDoc(
        id,
        Number(c.req.param("version")),
        await callerActor(c),
      ),
    );
  })
  .get("/:id/links", async (c) => {
    const id = c.req.param("id");
    const [inbound, outbound] = await Promise.all([
      backlinks({ docId: id }),
      outboundLinks({ docId: id }),
    ]);
    return c.json({ inbound, outbound });
  })
  .get("/:id/views", async (c) => {
    const target = { docId: c.req.param("id") };
    const [stats, history] = await Promise.all([
      viewStats(target),
      viewHistory(target),
    ]);
    return c.json({ ...stats, history });
  })
  // A PDF or Office file becomes a doc whose body is its text, and the file is
  // kept as the doc's original.
  .post("/files", async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > requestLimitBytes()) throw tooLarge(declared);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    const filing = uploadFilingSchema.safeParse(
      Object.fromEntries(
        Object.entries(form).filter(([key]) => key !== "file"),
      ),
    );
    if (!filing.success)
      throw badInput(filing.error.issues.map((i) => i.message).join("; "));
    await assertScopeEditor(c, {
      productId: filing.data.productId,
      teamId: filing.data.teamId,
    });
    const filename = basename(file.name || "upload");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = inspectFile(filename, bytes);
    if ("refusal" in check) return problem(c, 415, { detail: check.refusal });
    if (!keepsOriginal(check.contentType))
      return problem(c, 415, {
        detail: "a doc keeps the original of a PDF, Word or Excel file",
      });
    const family = fileFamily(check.contentType);
    const limitBytes = uploadLimitBytes(family, uploadLimits());
    if (bytes.byteLength > limitBytes)
      throw tooLarge(bytes.byteLength, limitBytes, family);
    const extracted = await extractFile({
      filename,
      contentType: check.contentType,
      bytes,
    });
    if (!extracted.text.trim())
      throw badInput(`no text could be read out of '${filename}'`);
    const createdById = await callerUserId(c);
    const fileId = await saveLibraryFile(sql, {
      filename,
      contentType: check.contentType,
      bytes,
      createdBy: createdById,
    });
    return c.json(
      await saveReferenceDoc({
        title: filing.data.title ?? titleOf(filename),
        body: extracted.text,
        productId: filing.data.productId,
        teamId: filing.data.teamId,
        component: filing.data.component,
        customerSlug: filing.data.customerSlug,
        unit: filing.data.unit,
        source: filename,
        fileId,
        createdById,
        actor: await callerActor(c),
      }),
    );
  })
  .get("/:id/file", async (c) => {
    const file = await getDocFile(c.req.param("id"));
    if (!file) throw notFound("this doc keeps no original file");
    return c.body(new Uint8Array(file.bytes), 200, {
      ...INERT_HEADERS,
      "Content-Type": file.content_type,
      "Content-Disposition": contentDisposition(file.filename),
    });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const doc = await getReferenceDoc(id);
    countView({ docId: id }, await callerUserId(c));
    return c.json(doc);
  })
  .patch("/:id", validate("json", referenceUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const doc = await getReferenceDoc(id);
    await assertScopeEditor(c, {
      productId: doc.product_id,
      teamId: doc.team_id,
    });
    return c.json(
      await updateReferenceDoc(id, c.req.valid("json"), await callerActor(c)),
    );
  })
  .get("/", async (c) => {
    const rows = await listReferenceDocs({
      status: c.req.query("status"),
      kind: shelf(c),
      ...(await listFilters(c)),
    });
    return c.json(rows);
  })
  .post("/", validate("json", referenceInputSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(c, {
      productId: body.productId,
      teamId: body.teamId,
    });
    return c.json(
      await saveReferenceDoc({
        ...body,
        createdById: await callerUserId(c),
        actor: await callerActor(c),
      }),
    );
  });
