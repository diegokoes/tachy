import {
  decodeText,
  fileFamily,
  isPdf,
  type FileContentType,
} from "@tachy/contract";
import { badInput } from "../infra/errors";
import { stripHtml } from "../sources/html";
import { inspectFile } from "./inspect";
import { mailText } from "./mail";
import { documentText, workbookText } from "./office";
import { pdfText } from "./pdf";
import { formatBytes } from "./size";
import { readZipEntry, zipEntries } from "./zip";

export interface StoredFile {
  filename: string;
  /** What was found in the bytes when the file was taken in. Null: unchecked. */
  contentType: FileContentType | null;
  bytes: Uint8Array;
}

export interface ArchiveMember {
  name: string;
  sizeBytes: number;
}

export interface ExtractedFile {
  text: string;
  /** Of a PDF. */
  pages?: number;
  /** Of an archive read without naming a member; `text` is the same list. */
  members?: ArchiveMember[];
}

/** One file out of an archive, unpacked. The limit a chat upload has. */
const MEMBER_MAX_BYTES = 25 * 1024 * 1024;

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function listArchive(bytes: Uint8Array): ExtractedFile {
  const members = zipEntries(bytes).map(({ name, sizeBytes }) => ({
    name,
    sizeBytes,
  }));
  return {
    text: members
      .map((member) => `${member.name}\t${formatBytes(member.sizeBytes)}`)
      .join("\n"),
    members,
  };
}

/**
 * One file of an archive, read as the kind its own name and bytes make it. An
 * archive inside an archive is refused: each level unpacks again.
 */
async function extractMember(
  archive: StoredFile,
  member: string,
): Promise<ExtractedFile> {
  const entry = zipEntries(archive.bytes).find((e) => e.name === member);
  if (!entry)
    throw badInput(
      `${archive.filename} holds no '${member}'; read it without member for its list`,
    );
  const bytes = readZipEntry(archive.bytes, entry, MEMBER_MAX_BYTES);
  const filename = basename(entry.name);
  const check = inspectFile(filename, bytes);
  if ("refusal" in check) throw badInput(check.refusal);
  if (fileFamily(check.contentType) === "archive")
    throw badInput(`${filename} is an archive inside an archive; not read`);
  return extractFile({ filename, contentType: check.contentType, bytes });
}

/** A row stored before uploads were checked: a PDF by its magic, else text. */
const uncheckedType = (bytes: Uint8Array): FileContentType =>
  isPdf(bytes) ? "application/pdf" : "text/plain";

/**
 * A file as the text a model reads. `member` names one file of an archive;
 * without it an archive answers with what it holds.
 */
export async function extractFile(
  file: StoredFile,
  opts: { member?: string } = {},
): Promise<ExtractedFile> {
  const contentType = file.contentType ?? uncheckedType(file.bytes);
  const family = fileFamily(contentType);
  if (opts.member && family !== "archive")
    throw badInput(
      `${file.filename} is not an archive; read it without member`,
    );

  if (family === "archive")
    return opts.member
      ? extractMember(file, opts.member)
      : listArchive(file.bytes);
  if (family === "image")
    throw badInput(
      `${file.filename} is an image, which has no text to extract; ask the user what it shows`,
    );
  if (family === "pdf") return pdfText(file.bytes);
  if (family === "mail") return { text: await mailText(file.bytes) };
  if (family === "document") return { text: documentText(file.bytes) };
  if (family === "sheet") return { text: workbookText(file.bytes) };

  const text = decodeText(file.bytes) ?? new TextDecoder().decode(file.bytes);
  return { text: contentType === "text/html" ? stripHtml(text) : text };
}
