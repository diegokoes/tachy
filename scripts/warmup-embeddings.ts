// Reaches past @tachy/core to the model registry alone, so the Dockerfile can
// run this before it copies the source: the layer holding the 417MB download
// then survives every change that isn't a change of model.
import { model, EMBEDDING_MODEL } from "../packages/core/src/search/model";

await model();
console.log(`embedding model cached: ${EMBEDDING_MODEL}`);
