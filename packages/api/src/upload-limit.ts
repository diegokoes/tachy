import { largestUploadBytes, tooLargeReason } from "@tachy/core";
import type { FileFamily } from "@tachy/core";
import { uploadLimits } from "@tachy/core/chat";
import { badInput } from "@tachy/core/infra";

/** The largest body a route that takes files reads, whatever the file is. */
export const requestLimitBytes = () => largestUploadBytes(uploadLimits());

export const tooLarge = (
  bytes: number,
  limitBytes = requestLimitBytes(),
  family?: FileFamily,
) => badInput(tooLargeReason(bytes, limitBytes, family));
