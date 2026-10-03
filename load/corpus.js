/**
 * Queries drawn from the words the seeder actually writes
 * (packages/cli/src/seed/corpus.ts). They have to match something, or every
 * search leg returns empty and the run measures an empty-result path.
 */
export const QUERIES = [
  "printer stops mid-batch",
  "labels come out blank",
  "scanner returns ECONNREFUSED",
  "queue depth grows without draining",
  "firmware update stalls",
  "ink level reads negative",
  "duplicate barcodes",
  "timestamps drift after DST",
  "report export times out",
  "device drops off the registry",
  "colour profile reverts",
  "web console stale device list",
];

export const DOC_QUERIES = [
  "installing the print driver",
  "network requirements",
  "firmware rollout",
  "barcode symbology",
  "troubleshooting the scanner bridge",
  "backup and restore",
  "colour calibration",
  "upgrade runbook",
];
