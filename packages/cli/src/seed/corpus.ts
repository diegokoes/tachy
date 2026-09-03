/**
 * The text the seeded rows are built from. It reads like a support desk for an
 * industrial print product because the lexical search legs actually match on
 * it: `load/lib/corpus.js` draws its k6 queries from the same words.
 */

export const PRODUCTS = [
  ["tpd", "Track & Trace Platform"],
  ["ftrace", "Fleet Trace"],
  ["inkmon", "Ink Monitor"],
  ["labelctl", "Label Controller"],
  ["scanhub", "Scan Hub"],
  ["palletiq", "Pallet IQ"],
  ["dryline", "Dryline Manager"],
  ["colorsync", "Colour Sync"],
] as const;

export const COMPONENT_NAMES = [
  "printer driver",
  "label renderer",
  "scanner bridge",
  "queue dispatcher",
  "web console",
  "reporting service",
  "device registry",
  "firmware updater",
  "ink telemetry",
  "batch scheduler",
  "audit log",
  "auth gateway",
];

export const SYMPTOMS = [
  "printer stops mid-batch",
  "labels come out blank",
  "scanner returns ECONNREFUSED",
  "queue depth grows without draining",
  "web console shows a stale device list",
  "firmware update stalls at 40 percent",
  "ink level reads negative",
  "duplicate barcodes on consecutive pallets",
  "timestamps drift by one hour after DST",
  "report export times out",
  "device drops off the registry overnight",
  "colour profile reverts to default",
  // Everything below is extra surface area. The twelve above are matched
  // verbatim by load/lib/corpus.js, so they stay first and unaltered.
  "print head parks mid-job and will not resume",
  "the reject gate fires on good product",
  "weight readings jump by a factor of ten",
  "the shift report counts the same pallet twice",
  "operators are logged out after ninety seconds",
  "the label preview differs from what prints",
  "serial numbers restart from one after a power cut",
  "the camera trigger fires twice per bottle",
  "an aggregation code is accepted but never stored",
  "the line stops when the printer buffer fills",
  "codes print mirrored on the second lane",
  "the handheld cannot pair after a firmware update",
  "throughput halves when the second printer is enabled",
  "the audit export omits the last hour of the shift",
  "a batch closes with fewer codes than it produced",
  "the dryer overshoots its setpoint by twenty degrees",
  "ink cost per thousand doubles overnight",
  "the console clock is an hour behind the PLC",
];

/**
 * ROOT_CAUSES[n] and RESOLUTIONS[n] are a matched pair: the fix addresses that
 * cause. Draw them with one index, never two, or the corpus reads as nonsense —
 * "timestamps drift after DST" fixed by "widen the column to int32" is not
 * something a reader can judge a search result against.
 */
export const ROOT_CAUSES = [
  "the driver holds the USB handle open across a reconnect",
  "the renderer caches a template that the console already replaced",
  "a firewall rule closes idle connections after 60 seconds",
  "the dispatcher retries without backoff and saturates the worker pool",
  "the registry heartbeat is shorter than the NAT translation timeout",
  "the firmware image is served without a content-length header",
  "the telemetry counter is unsigned and wraps at zero",
  "the sequence generator is seeded from the wall clock",
  "the scheduler stores local time rather than UTC",
  "the export runs unpaginated against the full history table",
  "the encoder pulse count is read before the sensor debounce settles",
  "two workers claim the same job because the lock is advisory",
  "the template is resolved by name and a second one shadows it",
  "the buffer is sized for one lane and the second lane shares it",
  "the PLC reports the previous cycle's value on a fast poll",
  "the batch id is derived from the local date, which rolls at midnight",
  "the reject counter is incremented before the verification result returns",
  "an int16 holds a value the scales can exceed",
  "the session cookie is issued without a renewal window",
  "the camera and the printer disagree about which edge starts a cycle",
  "the aggregation write is fire-and-forget and its failure is swallowed",
  "the firmware and the driver negotiate different USB packet sizes",
  "the report joins on a nullable column and drops the unmatched rows",
  "the setpoint ramp ignores the thermal mass of a full dryer",
  "the print queue is flushed on reconnect rather than replayed",
  "a retry re-uses the same idempotency key for a different payload",
  "the certificate chain omits the intermediate on one of the nodes",
  "the index is on the wrong column order for this predicate",
];

export const RESOLUTIONS = [
  "restart the driver service and re-enumerate the device",
  "clear the render cache and re-publish the template",
  "raise the keepalive interval below the firewall idle timeout",
  "enable exponential backoff on the dispatcher retry path",
  "shorten the heartbeat to 30 seconds",
  "serve the firmware image through the CDN with a content-length",
  "clamp the telemetry counter at zero and reset the baseline",
  "seed the sequence from the device id instead of the clock",
  "store UTC and convert at render time",
  "paginate the export and stream it",
  "debounce the encoder input and read the pulse after it settles",
  "take a real advisory lock keyed on the job id",
  "resolve templates by id and fail loudly on a duplicate name",
  "give each lane its own buffer and size it for peak, not average",
  "poll the PLC on its own cycle rather than the console's",
  "derive the batch id from UTC and stamp the shift separately",
  "increment the reject counter only after verification returns",
  "widen the column to int32 and backfill the truncated rows",
  "issue the session with a renewal window and refresh it on activity",
  "agree one trigger edge in the line configuration and validate it at start",
  "await the aggregation write and surface its failure to the operator",
  "pin the USB packet size in the driver to what the firmware negotiates",
  "make the join explicit and left-join so unmatched rows survive",
  "ramp the setpoint against measured mass rather than a fixed curve",
  "replay the print queue on reconnect instead of flushing it",
  "derive the idempotency key from the payload, not the attempt",
  "ship the full certificate chain to every node and check it on deploy",
  "reorder the index to match the predicate and drop the old one",
];

export const PATTERN_SLUGS = [
  "config-drift",
  "resource-leak",
  "network-timeout",
  "clock-skew",
  "cache-invalidation",
  "retry-storm",
  "integer-overflow",
  "missing-index",
  "permission-gap",
  "version-mismatch",
  "race-condition",
  "disk-pressure",
  "encoding-mismatch",
  "stale-firmware",
  "unbounded-query",
  "connection-pool-exhaustion",
  "dst-transition",
  "partial-write",
  "orphaned-record",
  "certificate-expiry",
  "throttled-upstream",
  "malformed-payload",
  "deadlock",
  "memory-fragmentation",
  "silent-truncation",
];

export const CUSTOMER_NAMES = [
  "Northwind Packaging",
  "Baltic Print Works",
  "Cedar Ridge Labels",
  "Orbit Logistics",
  "Harbourside Foods",
  "Vantage Cartons",
  "Ironwood Mills",
  "Silverline Dairy",
  "Kestrel Pharma",
  "Redstone Beverages",
  "Alder Bay Seafood",
  "Copperfield Textiles",
];

export const TAGS = [
  "regression",
  "hardware",
  "network",
  "performance",
  "data-integrity",
  "ux",
  "security",
  "upgrade",
  "integration",
  "documentation",
];

export const CLOUDS = ["prod", "qa", "demo", "preprod", "dev"];

/**
 * Fragments that combine with the lists above. The point is combinatorial
 * reach: composing one symptom with one cause and one resolution gives a few
 * hundred distinct bodies, which is not enough to exercise a vector index —
 * every row ends up sharing a handful of embeddings. Adding independent
 * dimensions multiplies instead of adding.
 */
export const CONTEXTS = [
  "only on the night shift",
  "after a firmware rollout",
  "since the site moved to the new switch",
  "when both lanes run at full rate",
  "on the first job after a cold start",
  "intermittently, roughly once a week",
  "only for one product variant",
  "after the daily maintenance window",
  "when the network link fails over",
  "on the oldest two printers only",
  "immediately after a shift changeover",
  "when the queue is already deep",
];

export const IMPACTS = [
  "the line stops until an operator intervenes",
  "product is rejected that should have passed",
  "the shift report cannot be reconciled",
  "codes are lost and the batch has to be reprinted",
  "throughput drops by about a third",
  "the operator works around it by restarting the console",
  "nothing is lost but the alarm masks real faults",
  "the customer's own audit flags the gap",
];

export const DIAGNOSTICS = [
  "the driver log shows the handle never closing",
  "packet capture shows the RST arriving from the firewall",
  "the counter is visible going negative in telemetry",
  "the PLC trace and the console timestamps differ by one cycle",
  "the queue table shows two rows with the same claim",
  "the export query plan shows a sequential scan",
  "the device reports a different firmware build than the registry",
  "the certificate expiry is inside the incident window",
];

export const FACT_KINDS = [
  "version",
  "integration",
  "line_layout",
  "contract",
  "contact",
];

export const DOC_TITLES = [
  "Installing the print driver",
  "Network requirements",
  "Firmware rollout procedure",
  "Barcode symbology reference",
  "Troubleshooting the scanner bridge",
  "Backup and restore",
  "Colour calibration guide",
  "Device onboarding checklist",
  "Retention and audit policy",
  "Upgrade runbook",
  // Extra titles, beyond the eight load/lib/corpus.js queries against.
  "Line commissioning checklist",
  "Aggregation and serialisation overview",
  "PLC integration reference",
  "Camera alignment procedure",
  "Shift handover and reporting",
  "Disaster recovery drill",
  "Printer maintenance schedule",
  "Certificate rotation",
  "Capacity planning notes",
  "Glossary of line terminology",
];

export const SECTION_HEADINGS = [
  "Overview",
  "Prerequisites",
  "Procedure",
  "Verification",
  "Rollback",
  "Known limitations",
  "Troubleshooting",
  "Escalation",
  "Related settings",
  "Change history",
];

/**
 * Names the code generator composes paths and identifiers from. The point is
 * that a chunk's text names the file it sits in, so two chunks are never the
 * same string and a trigram search for an identifier lands somewhere specific.
 */
export const CODE_AREAS = [
  "dispatch",
  "registry",
  "telemetry",
  "render",
  "queue",
  "firmware",
  "audit",
  "calibration",
  "aggregation",
  "session",
  "transport",
  "scheduler",
];

export const CODE_NOUNS = [
  "job",
  "device",
  "batch",
  "label",
  "pallet",
  "profile",
  "reading",
  "shift",
  "code",
  "lane",
];

export const CODE_LANGS = [
  ["typescript", "ts"],
  ["javascript", "js"],
  ["python", "py"],
  ["go", "go"],
  ["java", "java"],
  ["csharp", "cs"],
] as const;

/**
 * Snippet shapes, not one snippet. Each interpolates the identifiers of the
 * file it belongs to, so `code_chunks.chunk_text` is distinct per row -- it was
 * a single shared constant, which gave 60k identical rows at --scale=large and,
 * under --embed, 60k identical vectors and a degenerate HNSW graph.
 */
export const CODE_TEMPLATES: ((n: Names) => string)[] = [
  (
    n,
  ) => `export async function ${n.fn}(${n.arg}: ${n.type}): Promise<${n.type}Result> {
  const target = await ${n.area}.lookup(${n.arg}.id);
  if (!target) throw new Error(\`unknown ${n.noun} \${${n.arg}.id}\`);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await target.send(${n.arg}.payload);
    } catch (err) {
      await sleep(backoff(attempt));
    }
  }
  throw new Error("${n.fn} exhausted retries");
}`,
  (n) => `export class ${n.type}Store {
  private readonly cache = new Map<string, ${n.type}>();

  async get(id: string): Promise<${n.type} | undefined> {
    if (!this.cache.has(id)) this.cache.set(id, await this.load(id));
    return this.cache.get(id);
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }
}`,
  (n) => `/** Reconciles the ${n.noun} counters after a ${n.area} restart. */
export function reconcile${n.type}(rows: ${n.type}[], since: Date): ${n.type}[] {
  return rows
    .filter((r) => r.observedAt >= since)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((r, i) => ({ ...r, ordinal: i, ${n.arg}: normalize(r.${n.arg}) }));
}`,
  (n) => `export const ${n.fn}Config = {
  retries: MAX_RETRIES,
  timeoutMs: ${n.type.length * 500},
  ${n.arg}: process.env.${n.area.toUpperCase()}_${n.noun.toUpperCase()} ?? "default",
  onError: (err: unknown) => log.warn("${n.area}", { ${n.noun}: String(err) }),
};`,
  (n) => `func ${n.type}Handler(w http.ResponseWriter, r *http.Request) {
\t${n.arg}, err := ${n.area}.Parse(r.Body)
\tif err != nil {
\t\thttp.Error(w, "bad ${n.noun}", http.StatusBadRequest)
\t\treturn
\t}
\tjson.NewEncoder(w).Encode(${n.area}.${n.fn}(${n.arg}))
}`,
  (n) => `def ${n.fn}_${n.noun}(${n.arg}, *, retries=MAX_RETRIES):
    """Send one ${n.noun} through the ${n.area} and return its result."""
    for attempt in range(retries):
        try:
            return ${n.area}.send(${n.arg})
        except TransientError:
            time.sleep(backoff(attempt))
    raise RuntimeError(f"{${n.arg}!r} exhausted retries")`,
  (n) => `export function use${n.type}(${n.arg}: string) {
  const [state, setState] = useState<${n.type} | null>(null);
  useEffect(() => {
    let live = true;
    ${n.area}.watch(${n.arg}, (next) => live && setState(next));
    return () => { live = false; };
  }, [${n.arg}]);
  return state;
}`,
  (n) => `public sealed class ${n.type}Worker : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var ${n.arg} = await _${n.area}.DequeueAsync(stoppingToken);
            await _${n.area}.${n.fn.charAt(0).toUpperCase() + n.fn.slice(1)}Async(${n.arg});
        }
    }
}`,
  (n) => `-- ${n.area}: the ${n.noun} rollup the shift report reads
select ${n.arg}.id, count(*) as ${n.noun}_count, max(${n.arg}.observed_at) as last_seen
from ${n.area}_${n.noun}s ${n.arg}
where ${n.arg}.observed_at >= now() - interval '1 day'
group by ${n.arg}.id
having count(*) > ${n.type.length};`,
  (n) => `export function validate${n.type}(input: unknown): ${n.type} {
  const parsed = ${n.type.toLowerCase()}Schema.safeParse(input);
  if (!parsed.success)
    throw badInput(\`${n.noun}: \${parsed.error.issues[0].message}\`);
  if (parsed.data.${n.arg} < 0)
    throw badInput("${n.noun} ${n.arg} cannot be negative");
  return parsed.data;
}`,
];

export interface Names {
  area: string;
  noun: string;
  fn: string;
  arg: string;
  type: string;
}

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The identifiers one generated file uses, so its chunks read as one file. */
export function namesFor(area: string, noun: string, verb: string): Names {
  return {
    area,
    noun,
    fn: `${verb}${titleCase(noun)}`,
    arg: noun,
    type: titleCase(area),
  };
}

export const CODE_VERBS = [
  "dispatch",
  "resolve",
  "publish",
  "reconcile",
  "collect",
  "verify",
  "replay",
  "flush",
];

export const ARTIFACT_BODIES = [
  "Summarise the open work items for {{product}} and group them by component.",
  "List every knowledge entry touching {{component}} that has no fixed version, newest first.",
  "Draft a customer-facing note for {{customer}} explaining the current status of {{product}}.",
  "Compare the resolution patterns seen on {{product}} this quarter against the last one.",
  "For {{customer}}, list the components they run and the versions we have observed.",
  "Find the reference docs that contradict a knowledge entry about {{component}}.",
  "Build a handover for the next shift: what is open, what moved, what is blocked.",
];

export const MESSAGE_OPENERS = [
  "We are seeing",
  "The line reported",
  "An operator called in",
  "Overnight monitoring flagged",
  "The site engineer confirmed",
  "Second shift reports",
];

export const MESSAGE_STEPS = [
  "checked the logs",
  "pulled a packet capture",
  "compared the two lines",
  "rolled the firmware back",
  "restarted the service",
  "raised it with the vendor",
  "reproduced it on the test rig",
  "read the counters directly off the PLC",
];

export const MESSAGE_OUTCOMES = [
  "no change",
  "partially reproduced",
  "confirmed",
  "cannot reproduce",
  "worse after the restart",
  "clean for now, watching it",
];

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
