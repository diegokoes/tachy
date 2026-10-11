import type { Sharp } from "sharp";
import { badInput } from "../infra/errors";
import { errorText } from "../infra/known-secrets";

/**
 * The longest edge of an image as a model is given it. The API refuses larger
 * ones in a request that holds many, and what a larger one adds is rarely
 * worth its tokens.
 */
export const MODEL_IMAGE_MAX_EDGE_PX = 2000;

/** An image that decodes to more pixels is refused: it is small only on disk. */
const IMAGE_MAX_PIXELS = 50_000_000;

const LOSSY_QUALITY = 85;

export interface ModelImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

let loading: Promise<typeof import("sharp")> | undefined;

/**
 * Loaded on first use: the binding is native, and a process that reads no
 * image should not pay for it. One thread and no cache, since it runs inside
 * processes sized for something else.
 */
async function loadSharp() {
  loading ??= import("sharp").then((module) => {
    module.default.cache(false);
    module.default.concurrency(1);
    return module;
  });
  return (await loading).default;
}

/** A photo stays lossy and a screenshot lossless, as each was made. */
function encoded(image: Sharp, sourceFormat: string | undefined): Sharp {
  if (sourceFormat === "jpeg") return image.jpeg({ quality: LOSSY_QUALITY });
  if (sourceFormat === "webp") return image.webp({ quality: LOSSY_QUALITY });
  return image.png();
}

/**
 * An image as it is sent to a model: upright, at most
 * MODEL_IMAGE_MAX_EDGE_PX on its longest edge, and written afresh, which
 * leaves its metadata (a camera's location, an author) behind. Only the first
 * frame of an animation is kept, which is all a model reads.
 */
export async function imageForModel(bytes: Uint8Array): Promise<ModelImage> {
  const sharp = await loadSharp();
  try {
    const source = sharp(bytes, {
      limitInputPixels: IMAGE_MAX_PIXELS,
      failOn: "error",
    });
    const { format } = await source.metadata();
    const fitted = source.autoOrient().resize({
      width: MODEL_IMAGE_MAX_EDGE_PX,
      height: MODEL_IMAGE_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    });
    const { data, info } = await encoded(fitted, format).toBuffer({
      resolveWithObject: true,
    });
    return {
      mimeType: `image/${info.format}` as ModelImage["mimeType"],
      bytes: data,
      widthPx: info.width,
      heightPx: info.height,
    };
  } catch (e) {
    throw badInput(`the image cannot be read: ${errorText(e)}`);
  }
}
