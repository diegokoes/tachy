import { embedPassage, EMBEDDING_MODEL } from "@tachy/core";

await embedPassage("warmup");
console.log(`embedding model cached: ${EMBEDDING_MODEL}`);
