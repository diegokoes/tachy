/**
 * Buckets: collections maintained outside tachy and pushed in by a sync
 * script. Read-only here, and kept out of the library's own searches.
 */
import { z } from "zod";
import {
  getBucketDoc,
  listBuckets,
  readableBucket,
  readableBuckets,
  searchBucket,
} from "@tachy/core/buckets";
import { tool } from "../server";
import { GRADE_NOTE, outScrubbed, searchOut } from "../results";
import { gateUserId } from "../permissions";

const ABOUT =
  "A bucket is an external document collection (e.g. a product's public knowledge base) pushed into tachy by a sync script. It is NOT the library: never mix its hits with reference docs, wiki articles or knowledge entries, and never save what it says into the library unless the user asks.";

const bucketField = z.string().describe("Bucket slug, from list_buckets.");

tool(
  "list_buckets",
  {
    description: `List the buckets this user can read, with what each holds and when it was last updated. ${ABOUT}`,
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const ids = (await readableBuckets(await gateUserId())).map((b) => b.id);
    const rows = ids.length ? await listBuckets(ids) : [];
    return outScrubbed(
      rows.map((b) => ({
        slug: b.slug,
        name: b.name,
        description: b.description,
        source: b.source,
        docs: b.docs,
        last_batch_at: b.last_batch_at,
      })),
    );
  },
);

tool(
  "search_bucket",
  {
    description: `Search one bucket's documents (hybrid semantic + keyword). Returns the best-matching passage per document with its url and breadcrumb; cite the url when answering. ${ABOUT} ${GRADE_NOTE}`,
    inputSchema: {
      bucket: bucketField,
      query: z.string(),
      path_prefix: z
        .array(z.string())
        .optional()
        .describe(
          'Keep to one branch of the source\'s tree: the leading breadcrumb segments, e.g. ["Product", "Mobile App"].',
        ),
      limit: z.number().int().positive().max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ bucket, query, path_prefix, limit }) => {
    const readable = await readableBucket(await gateUserId(), bucket);
    return searchOut(
      await searchBucket(query, {
        bucketIds: [readable.id],
        pathPrefix: path_prefix,
        limit,
      }),
      "search_bucket",
    );
  },
);

tool(
  "get_bucket_doc",
  {
    description:
      "Fetch one bucket document in full by the `key` (or `id`) a search_bucket hit carries. Use it when a snippet is not enough to answer.",
    inputSchema: {
      bucket: bucketField,
      key: z.string(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ bucket, key }) => {
    const readable = await readableBucket(await gateUserId(), bucket);
    return outScrubbed(await getBucketDoc(readable.id, key));
  },
);
