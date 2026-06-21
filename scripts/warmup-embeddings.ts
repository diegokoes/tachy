import { embedPassage } from "@tachy/core";

// Forces fastembed to download and cache its model at image build time,
// instead of on a user's first real embedding call.
await embedPassage("warmup");
console.log("fastembed model cached.");
