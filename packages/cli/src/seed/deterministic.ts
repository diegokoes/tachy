import { createHash } from "node:crypto";
import { EMBEDDING_DIM } from "@tachy/core";

/**
 * Ids are derived from a hash of what they identify, never drawn from the PRNG
 * stream. Drawing them in order would mean that adding one field anywhere
 * shifts every id generated after it, and two runs of different builds of the
 * seeder would stop agreeing.
 */
function digest(kind: string, index: number): Buffer {
  return createHash("sha256").update(`tachy-seed:${kind}:${index}`).digest();
}

export function uuidFor(kind: string, index: number): string {
  const h = digest(kind, index).subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** mulberry32, seeded from the same hash so a stream is tied to its row. */
export function rngFor(kind: string, index: number): () => number {
  let a = digest(kind, index).readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many distinct directions the synthetic corpus spreads over. */
const CENTROIDS = 24;

const centroidCache = new Map<number, Float64Array>();

function centroid(i: number): Float64Array {
  let c = centroidCache.get(i);
  if (!c) {
    const rng = rngFor("centroid", i);
    c = new Float64Array(EMBEDDING_DIM);
    for (let k = 0; k < EMBEDDING_DIM; k++) c[k] = rng() - 0.5;
    centroidCache.set(i, c);
  }
  return c;
}

/**
 * A synthetic embedding: a centroid plus noise, renormalised. Uniformly random
 * 768-dim vectors are all near-equidistant, which gives HNSW a traversal
 * profile nothing like real text. Clustering keeps the graph shaped roughly
 * like one built from a real corpus.
 *
 * These do NOT resemble what the real model produces for the same text, so
 * search relevance against them is meaningless -- see load/README.md.
 */
export function unitVector(kind: string, index: number): Float64Array {
  const base = centroid(index % CENTROIDS);
  const noise = rngFor(kind, index);
  const v = new Float64Array(EMBEDDING_DIM);
  let sum = 0;
  for (let k = 0; k < EMBEDDING_DIM; k++) {
    const x = base[k] + (noise() - 0.5) * 0.6;
    v[k] = x;
    sum += x * x;
  }
  const norm = Math.sqrt(sum) || 1;
  for (let k = 0; k < EMBEDDING_DIM; k++) v[k] /= norm;
  return v;
}

/** pgvector's text input form; Postgres coerces it to the vector column. */
export function vectorLiteral(v: Float64Array | number[]): string {
  const parts = new Array<string>(v.length);
  for (let i = 0; i < v.length; i++) parts[i] = v[i].toFixed(6);
  return `[${parts.join(",")}]`;
}

export const pick = <T>(rng: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)];

export function pickMany<T>(
  rng: () => number,
  xs: readonly T[],
  n: number,
): T[] {
  const pool = [...xs];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++)
    out.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  return out;
}

export const chance = (rng: () => number, p: number): boolean => rng() < p;

export const intBetween = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

/** A timestamp inside the last `days`, deterministic for the given stream. */
export function pastDate(rng: () => number, days: number): Date {
  const ms = Date.now() - Math.floor(rng() * days * 86_400_000);
  return new Date(ms);
}
