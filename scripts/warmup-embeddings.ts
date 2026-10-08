// Reaches past @tachy/core to the model registry alone, so the Dockerfile can
// run this before it copies the source: the layer holding the model, a large
// download, then survives every change that is not a change of model. What
// search/model.ts imports, the Dockerfile has to copy beside it.
import { model, EMBEDDING_MODEL } from "../packages/core/src/search/model";

await model();
console.log(`embedding model cached: ${EMBEDDING_MODEL}`);
