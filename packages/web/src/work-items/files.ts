import {
  FILE_TYPES,
  attachmentPath,
  fileExtension,
  parseAttachmentRef,
  type WorkItemFile,
} from "@tachy/contract";

/** Where a ticket's file opens from, or null when its source opens none. */
export function fileHref(file: WorkItemFile): string | null {
  const ref = file.path ? parseAttachmentRef(file.path) : null;
  return ref ? attachmentPath(ref) : null;
}

/** Whether to show it as a picture: by its name, since nothing was read yet. */
export function isPicture(file: WorkItemFile): boolean {
  const extension = fileExtension(file.name);
  return extension !== null && FILE_TYPES[extension].family === "image";
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What is known of a file beside its name, in the order a reader asks. */
export function fileDetails(file: WorkItemFile): string {
  return [
    file.size_bytes != null ? size(file.size_bytes) : null,
    file.from,
    file.at?.slice(0, 10),
    file.inline ? "in the message" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
