import { MAX_UPLOAD_BYTES, tooLargeReason } from "@tachy/core";
import { badInput } from "@tachy/core/infra";

export { MAX_UPLOAD_BYTES };

export const tooLarge = (bytes: number) => badInput(tooLargeReason(bytes));
