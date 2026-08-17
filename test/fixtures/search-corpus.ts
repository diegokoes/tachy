/**
 * A fixed corpus + golden query set for measuring retrieval quality.
 *
 * The point is not that these entries are realistic prose — it is that the
 * queries exercise the four ways someone actually searches, and that each one
 * has exactly one right answer:
 *
 *   - paraphrase   the query shares no keywords with the entry (vector leg)
 *   - identifier   a bare error code or symbol (trigram leg)
 *   - resolution   phrased as the fix, not the symptom (needs `resolution`
 *                  to be in the embedded text — it was not, historically)
 *   - facet        an environment or version word typed into the query, which
 *                  only works because they are part of search_text
 */

export interface CorpusEntry {
  key: string;
  issueSummary: string;
  symptoms: string[];
  signals: string[];
  rootCause: string;
  resolution: string;
  cloud?: string;
  affectedVersion?: string;
  tags?: string[];
}

export const KNOWLEDGE: CorpusEntry[] = [
  {
    key: "printer-023",
    issueSummary:
      "Printer error 023 TOO_MANY_STRINGS when printing a label with many variable fields",
    symptoms: ["error 023 on printer display", "label job rejected"],
    signals: ["023 TOO_MANY_STRINGS"],
    rootCause: "The label template exceeds the printer's string buffer limit.",
    resolution:
      "Reduce the number of variable text fields in the template, or split the label across two passes.",
    cloud: "prod",
    affectedVersion: "2.4.1",
    tags: ["printing"],
  },
  {
    key: "scanner-pairing",
    issueSummary:
      "Handheld barcode reader will not connect after a software upgrade",
    symptoms: ["scanner shows offline", "no pairing dialog appears"],
    signals: ["ECONNREFUSED"],
    rootCause: "The upgrade reset the Bluetooth pairing table.",
    resolution:
      "Re-pair the scanner from device settings, then restart the ingest service.",
    cloud: "qa",
    affectedVersion: "2.4.0",
    tags: ["devices"],
  },
  {
    key: "lc-template-cache",
    issueSummary:
      "Line controller stops distributing templates to downstream machines",
    symptoms: ["machines sit idle", "no template handoff"],
    signals: ["LC_TIMEOUT"],
    rootCause:
      "The line controller's template cache was not invalidated after a configuration change.",
    resolution: "Restart the label cache service on the line controller.",
    cloud: "prod",
    affectedVersion: "2.5.0",
    tags: ["lc"],
  },
  {
    key: "export-empty-pdf",
    issueSummary: "Monthly invoice export produces an empty PDF",
    symptoms: ["zero-byte PDF", "export completes without error"],
    signals: ["PDF_EMPTY"],
    rootCause: "The export cache retained a stale, empty render.",
    resolution: "Clear the export cache and re-run the monthly job.",
    cloud: "prod",
    affectedVersion: "2.3.7",
    tags: ["reporting"],
  },
  {
    key: "queue-backlog",
    issueSummary: "Ingest queue grows without bound after a broker restart",
    symptoms: ["queue depth climbing", "consumers idle"],
    signals: ["AMQP_RECONNECT"],
    rootCause:
      "The scheduler was never re-enabled after the broker came back up.",
    resolution:
      "Re-enable the scheduler and verify the dead-letter topic is draining.",
    cloud: "qa",
    affectedVersion: "2.5.0",
    tags: ["ingest"],
  },
  {
    key: "cert-expiry",
    issueSummary: "Machine agents disconnect every night at midnight UTC",
    symptoms: ["agents drop simultaneously", "reconnect loop"],
    signals: ["TLS_CERT_EXPIRED", "HTTP 495"],
    rootCause: "The agent client certificate expired and auto-renewal was off.",
    resolution: "Rotate the client certificate and re-enable auto-renewal.",
    cloud: "prod",
    affectedVersion: "2.4.1",
    tags: ["security"],
  },
];

export const REFERENCE = [
  {
    key: "deploy-runbook",
    title: "Deployment runbook",
    body: "Deployment runbook\n\nRestart the ingest service, verify the queue drains, then re-enable the scheduler.\n\nIf the queue does not drain within five minutes, check the broker connection and inspect the dead-letter topic before escalating.",
  },
  {
    key: "arch-overview",
    title: "Line controller architecture",
    body: "The line controller orchestrates machine handoffs across a production line.\n\nIt owns template distribution and keeps a local cache keyed by template revision. Downstream machines poll it for their current template.",
  },
];

/** query -> the one entry that should come back first. */
export const GOLDEN: { q: string; expect: string; why: string }[] = [
  { q: "023", expect: "printer-023", why: "identifier" },
  { q: "TOO_MANY_STRINGS", expect: "printer-023", why: "identifier" },
  { q: "ECONNREFUSED", expect: "scanner-pairing", why: "identifier" },
  { q: "TLS_CERT_EXPIRED", expect: "cert-expiry", why: "identifier" },
  { q: "scanner offline", expect: "scanner-pairing", why: "paraphrase" },
  {
    q: "handheld device will not pair",
    expect: "scanner-pairing",
    why: "paraphrase",
  },
  {
    q: "blank invoice document",
    expect: "export-empty-pdf",
    why: "paraphrase",
  },
  {
    q: "agents keep dropping their connection overnight",
    expect: "cert-expiry",
    why: "paraphrase",
  },
  {
    q: "restart the label cache service",
    expect: "lc-template-cache",
    why: "resolution",
  },
  {
    q: "clear the export cache",
    expect: "export-empty-pdf",
    why: "resolution",
  },
  {
    q: "rotate the client certificate",
    expect: "cert-expiry",
    why: "resolution",
  },
  { q: "prod printer error", expect: "printer-023", why: "facet" },
  { q: "2.3.7 empty pdf", expect: "export-empty-pdf", why: "facet" },
];

/** Queries that must return NOTHING — the case this whole design exists for. */
export const NONSENSE = ["ñ", "zzzzzz", "asdfgh", "qqqq wwww", "..."];
