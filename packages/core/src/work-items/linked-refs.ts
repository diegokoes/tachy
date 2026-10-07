import type { RawWorkItem } from "./raw";

const REF_PATTERNS = [
  /\bAB#(\d+)/g,
  /\bDevOps#(\d+)/gi,
  /dev\.azure\.com\/[^\s"']*\/_workitems\/edit\/(\d+)/gi,
];

const MAX_REFS = 10;

/**
 * Scan a fetched work item for Azure DevOps work item references
 * (AB#123, DevOps#123, dev.azure.com/.../_workitems/edit/123, and the
 * Freshdesk cf_devops_work_item custom field). Returns deduped ids.
 */
export function extractAdoRefs(raw: RawWorkItem): string[] {
  if (raw.kind === "work_item") return [];
  const ids = new Set<string>();

  const scan = (text: string) => {
    for (const pattern of REF_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) ids.add(match[1]);
    }
  };

  const payload = raw.raw as Record<string, any> | null | undefined;
  const customFields = payload?.custom_fields;
  if (customFields && typeof customFields === "object") {
    const direct = (customFields as Record<string, unknown>)
      .cf_devops_work_item;
    if (direct != null && String(direct).trim()) {
      const digits = String(direct).match(/(\d+)/);
      if (digits) ids.add(digits[1]);
    }
    scan(JSON.stringify(customFields));
  }
  if (raw.title) scan(raw.title);
  for (const msg of raw.messages) scan(msg.bodyText);

  return [...ids].slice(0, MAX_REFS);
}
