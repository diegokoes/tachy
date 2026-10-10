/**
 * A fixed corpus + golden query set for measuring retrieval quality.
 *
 * The point is not that these entries are realistic prose - it is that the
 * queries exercise the four ways someone searches, and that each one has one
 * right answer:
 *
 *   - paraphrase   the query shares no keywords with the entry (vector leg)
 *   - identifier   a bare error code or symbol (trigram leg)
 *   - resolution   phrased as the fix, not the symptom (needs `resolution`
 *                  in the embedded text)
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

/** Queries that must return nothing. */
export const NONSENSE = ["ñ", "zzzzzz", "asdfgh", "qqqq wwww", "..."];

/**
 * German ticket openings, each a title and the start of the first message
 * joined as `fetch_work_item` joins them for its search, with the English
 * entry that should come back first. None carries an error code: an
 * identifier matches by its letters in any language.
 */
export const TICKET_LEADS_DE: { q: string; expect: string }[] = [
  {
    q: "Etikettendrucker bricht Druckauftrag mit Fehlermeldung ab Guten Tag, seit gestern lehnt unser Drucker Etiketten mit vielen variablen Textfeldern ab. Auf dem Display erscheint eine Fehlermeldung und der Auftrag wird verworfen.",
    expect: "printer-023",
  },
  {
    q: "Handscanner verbindet sich nach Update nicht mehr Hallo, nach dem Software-Update von letzter Woche wird unser Barcode-Handscanner als offline angezeigt. Der Dialog zum Koppeln erscheint gar nicht mehr.",
    expect: "scanner-pairing",
  },
  {
    q: "Scanner geht nicht Scanner lässt sich seit dem Update nicht mehr koppeln, bitte um Hilfe.",
    expect: "scanner-pairing",
  },
  {
    q: "Maschinen erhalten keine Vorlagen mehr von der Liniensteuerung Seit der Konfigurationsänderung heute Morgen stehen die nachgelagerten Maschinen still. Die Liniensteuerung verteilt keine Vorlagen mehr.",
    expect: "lc-template-cache",
  },
  {
    q: "Monatlicher Rechnungsexport liefert leere PDF-Datei Der Export läuft ohne Fehlermeldung durch, aber die erzeugte PDF-Datei hat null Byte und lässt sich nicht öffnen.",
    expect: "export-empty-pdf",
  },
  {
    q: "PDF leer Rechnungen vom letzten Monat exportiert, Datei ist leer.",
    expect: "export-empty-pdf",
  },
  {
    q: "Warteschlange läuft seit Neustart des Brokers voll Nach dem Neustart des Message-Brokers wächst die Eingangswarteschlange immer weiter an. Die Verarbeiter tun nichts.",
    expect: "queue-backlog",
  },
  {
    q: "Maschinenagenten verlieren jede Nacht die Verbindung Jede Nacht um Mitternacht trennen sich alle Agenten gleichzeitig vom Server und versuchen danach endlos, sich neu zu verbinden.",
    expect: "cert-expiry",
  },
];
