/**
 * embeddings — local sentence embeddings for the RAG knowledge base.
 *
 * Anthropic (our inference provider) has no embeddings endpoint, so we embed
 * locally with sentence-transformers all-MiniLM-L6-v2 via Transformers.js. This
 * keeps the whole RAG pipeline self-contained: no extra vendor, no API key, no
 * per-call cost — well suited to the small single-document corpus we ground on.
 *
 * The SAME function embeds both the ingested passages (ingest script) and the
 * user's question at query time, so the vectors live in one comparable space.
 * Output is 384-dimensional and L2-normalised (mean-pooled), which must match
 * `vector(384)` in prisma/rag.sql.
 *
 * NOTE: this has nothing to do with the SCR/FFP engine. Embeddings drive text
 * retrieval only; the deterministic maths stays in @85percent/engine.
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers'

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIMENSIONS = 384

// The model is loaded once (downloaded + cached under node_modules/.cache on
// first use) and reused. We memoise the promise so concurrent callers share a
// single load rather than racing to initialise the pipeline.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL)
  }
  return extractorPromise
}

/**
 * Embed a single string into a 384-dim, mean-pooled, normalised vector.
 * Returns a plain number[] ready to send to Postgres/pgvector.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  // `output.data` is a Float32Array; pgvector wants a JSON number array.
  return Array.from(output.data as Float32Array)
}

/** Embed many strings sequentially (the model is single-threaded in-process). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = []
  for (const text of texts) {
    vectors.push(await embedText(text))
  }
  return vectors
}
