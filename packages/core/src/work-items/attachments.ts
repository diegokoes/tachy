import {
  attachmentRef,
  fileFamily,
  largestUploadBytes,
  tooLargeReason,
  uploadLimitBytes,
  type WorkItemFile,
} from "@tachy/contract";
import { uploadLimits } from "../chat/uploads";
import { inspectFile } from "../files/inspect";
import type { StoredFile } from "../files/extract";
import { badInput } from "../infra/errors";
import type { WorkItemSource } from "../sources/source";
import type { RawWorkItem } from "./raw";

/**
 * The files of an item in one list, each with who sent the message it is on.
 * `source` is the connection's slug; without one, or when the source opens no
 * files, the entries carry no reference to read them by.
 */
export function listFiles(
  item: RawWorkItem,
  opening?: { source: string; opens: boolean },
): WorkItemFile[] {
  return item.messages.flatMap((message) =>
    (message.attachments ?? []).map((file) => ({
      name: file.name,
      ...(file.contentType ? { type: file.contentType } : {}),
      ...(file.sizeBytes != null ? { size_bytes: file.sizeBytes } : {}),
      ...(message.authorLabel || message.author
        ? { from: message.authorLabel ?? message.author }
        : {}),
      ...(message.createdAt ? { at: message.createdAt } : {}),
      ...(file.inline ? { inline: true } : {}),
      ...(opening?.opens
        ? {
            path: attachmentRef({
              source: opening.source,
              externalId: item.externalId,
              attachmentId: file.id,
            }),
          }
        : {}),
    })),
  );
}

async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  name: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw badInput(
        `${name} is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB that is read; open it on the ticket`,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let filled = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, filled);
    filled += chunk.length;
  }
  return bytes;
}

/**
 * A file of an item, read whole from its source, up to the largest size an
 * upload may have. What it is has not been looked at yet.
 */
export async function readAttachmentBytes(
  source: WorkItemSource,
  externalId: string,
  attachmentId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  if (!source.openAttachment)
    throw badInput(
      `${source.type} files cannot be opened from here; open it on the ticket`,
    );
  const opened = await source.openAttachment(externalId, attachmentId);
  const bytes = await readCapped(
    opened.body,
    largestUploadBytes(uploadLimits()),
    opened.name,
  );
  return { filename: opened.name, bytes };
}

/**
 * A file of an item as something tachy reads, held to what an upload is: its
 * kind comes from its name and its bytes, never from what the source or the
 * sender said it was, and its size to that kind's limit. One there is no
 * reader for is refused by name.
 */
export async function readAttachment(
  source: WorkItemSource,
  externalId: string,
  attachmentId: string,
): Promise<StoredFile> {
  const { filename, bytes } = await readAttachmentBytes(
    source,
    externalId,
    attachmentId,
  );
  const check = inspectFile(filename, bytes);
  if ("refusal" in check) throw badInput(check.refusal);
  const family = fileFamily(check.contentType);
  const limitBytes = uploadLimitBytes(family, uploadLimits());
  if (bytes.length > limitBytes)
    throw badInput(
      `${filename}: ${tooLargeReason(bytes.length, limitBytes, family)}; open it on the ticket`,
    );
  return { filename, contentType: check.contentType, bytes };
}
