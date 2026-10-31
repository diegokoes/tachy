// Reaches past @tachy/core to the model registry alone, so the Dockerfile can
// run this before it copies the source: the layer holding the model, a large
// download, then survives every change that is not a change of model. What
// search/model.ts imports, the Dockerfile has to copy beside it.
import { model, EMBEDDING_MODEL } from "../packages/core/src/search/model";

/**
 * A download the host cuts off fails the image build, and another try usually
 * gets through: an interrupted file is never kept, so a try starts clean.
 */
const DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15_000;

for (let attempt = 1; ; attempt++) {
  try {
    await model();
    break;
  } catch (e) {
    if (attempt === DOWNLOAD_ATTEMPTS) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(
      `embedding model download failed (${reason}); try ${attempt + 1} of ${DOWNLOAD_ATTEMPTS} in ${RETRY_DELAY_MS / 1000}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
console.log(`embedding model cached: ${EMBEDDING_MODEL}`);
