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
];

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
];

export const CODE_SNIPPET = `export async function dispatch(job: Job): Promise<Result> {
  const device = await registry.lookup(job.deviceId);
  if (!device) throw new Error(\`unknown device \${job.deviceId}\`);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await device.send(job.payload);
    } catch (err) {
      await sleep(backoff(attempt));
    }
  }
  throw new Error("dispatch exhausted retries");
}`;

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
