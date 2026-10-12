import {
  FILE_TYPES,
  checkFile,
  fileExtension,
  mismatchReason,
  type FileCheck,
} from "@tachy/contract";
import { DOCUMENT_PART, WORKBOOK_PART } from "./office";
import { zipEntries } from "./zip";

/** The part an office file must hold to be what its extension says. */
const REQUIRED_PART = { document: DOCUMENT_PART, sheet: WORKBOOK_PART };

function holdsPart(bytes: Uint8Array, part: string): boolean {
  try {
    return zipEntries(bytes).some((entry) => entry.name === part);
  } catch {
    return false;
  }
}

/**
 * `checkFile`, and for an office file the look inside that the contract cannot
 * take: its bytes are a zip either way, so only its parts tell a document from
 * an archive renamed to one.
 */
export function inspectFile(filename: string, bytes: Uint8Array): FileCheck {
  const check = checkFile(filename, bytes);
  const extension = fileExtension(filename);
  if ("refusal" in check || !extension) return check;
  const { family } = FILE_TYPES[extension];
  if (family !== "document" && family !== "sheet") return check;
  return holdsPart(bytes, REQUIRED_PART[family])
    ? check
    : { refusal: mismatchReason(filename, extension) };
}
