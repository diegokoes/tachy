import PostalMime, { type Address, type Attachment } from "postal-mime";
import { stripHtml } from "../sources/html";
import { formatBytes } from "./size";

const mailbox = (entry: { name: string; address?: string }) =>
  entry.name && entry.address
    ? `${entry.name} <${entry.address}>`
    : entry.address || entry.name;

/** A group shows as its members: the group's own name is a label, not a person. */
const addressList = (addresses: Address[] | undefined) =>
  (addresses ?? [])
    .flatMap((entry) => (entry.group ? entry.group : [entry]))
    .map(mailbox)
    .join(", ");

function attachmentBytes(content: Attachment["content"]): number {
  return typeof content === "string"
    ? new TextEncoder().encode(content).length
    : content.byteLength;
}

/** Named, not read: the files inside a mail are reached from where it came. */
const describeAttachment = (attachment: Attachment) =>
  `${attachment.filename ?? "unnamed"} (${formatBytes(attachmentBytes(attachment.content))}, ${attachment.mimeType})`;

/**
 * A mail file as text: who, when, the subject, the body, and its attachments
 * by name. The plain part is used where the mail has one.
 */
export async function mailText(bytes: Uint8Array): Promise<string> {
  const mail = await PostalMime.parse(bytes);
  const headers = [
    ["From", addressList(mail.from ? [mail.from] : [])],
    ["To", addressList(mail.to)],
    ["Cc", addressList(mail.cc)],
    ["Date", mail.date ?? ""],
    ["Subject", mail.subject ?? ""],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`);
  const body = mail.text?.trim() || stripHtml(mail.html ?? "");
  const attachments = mail.attachments.length
    ? `Attachments: ${mail.attachments.map(describeAttachment).join("; ")}`
    : "";
  return [headers.join("\n"), body, attachments].filter(Boolean).join("\n\n");
}
