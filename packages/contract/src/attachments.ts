/**
 * How a file on a ticket is named to the agent and its tools: the connection,
 * the item and the source's id for the file. Like an upload's reference it is
 * not an address; the server asks the source for the bytes each time.
 */
export interface AttachmentRef {
  source: string;
  externalId: string;
  attachmentId: string;
}

const PREFIX = "attachment:";

export const attachmentRef = (ref: AttachmentRef) =>
  PREFIX +
  [ref.source, ref.externalId, ref.attachmentId]
    .map(encodeURIComponent)
    .join("/");

export function parseAttachmentRef(ref: string): AttachmentRef | null {
  const trimmed = ref.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const parts = trimmed.slice(PREFIX.length).split("/");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const [source, externalId, attachmentId] = parts.map(decodeURIComponent);
    return { source, externalId, attachmentId };
  } catch {
    return null;
  }
}

/** Where the SPA opens the file from, with the reader's own source token. */
export const attachmentPath = (ref: AttachmentRef) =>
  `/api/work-items/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.externalId)}/attachments/${encodeURIComponent(ref.attachmentId)}`;

/** A file of a work item, as a read of the item lists it. */
export interface WorkItemFile {
  name: string;
  /** What the source says it is; the bytes decide when it is opened. */
  type?: string;
  size_bytes?: number;
  /** Who sent the message it is on, and when. */
  from?: string;
  at?: string;
  /** Placed in the message's body, as a pasted screenshot is. */
  inline?: boolean;
  /** Its reference, for `read_file`. Absent when its source opens no files. */
  path?: string;
}
