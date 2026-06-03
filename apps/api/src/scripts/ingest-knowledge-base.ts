/**
 * ingest-knowledge-base — Phase 1 RAG ingest.
 *
 * Fetches the grounding source (the Nov 2025 Premier League financial-system
 * explainer), strips it to readable text, chunks it semantically, embeds each
 * chunk with the local model, and stores the rows in `documents`.
 *
 * Run with:  pnpm --filter @headroom/api ingest:kb
 * (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in apps/api/.env and the
 *  prisma/rag.sql migration applied to the database first).
 *
 * Idempotent: it deletes any existing rows for this source_url before inserting
 * the fresh set, so re-running simply refreshes the knowledge base.
 */

import { supabase } from '../lib/supabase.js'
import { embedText } from '../lib/embeddings.js'
import { KNOWLEDGE_SOURCE_URL } from '../services/ai/knowledge-source.js'

// Target chunk size in characters. ~700 chars (~150 tokens) keeps each passage
// focused enough for precise retrieval while preserving sentence context.
const TARGET_CHUNK_CHARS = 700
const CHUNK_OVERLAP_CHARS = 120
const MIN_CHUNK_CHARS = 80

/** Strip HTML to plain readable text. Good enough for a server-rendered article. */
function htmlToText(html: string): string {
  return html
    // Drop non-content elements wholesale.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // Turn block boundaries into paragraph breaks so chunking respects structure.
    .replace(/<\/(p|div|section|article|h[1-6]|li|br)\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove all remaining tags.
    .replace(/<[^>]+>/g, ' ')
    // Decode the handful of entities that actually appear in prose.
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&pound;/g, '£')
    // Collapse whitespace; keep blank lines as paragraph separators.
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Chunk text on paragraph boundaries, packing paragraphs up to the target size
 * and carrying a small overlap between chunks so a fact split across a boundary
 * is still retrievable from both sides.
 */
function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed.length >= MIN_CHUNK_CHARS) chunks.push(trimmed)
    current = ''
  }

  for (const para of paragraphs) {
    // A single oversized paragraph is split on sentence boundaries.
    if (para.length > TARGET_CHUNK_CHARS) {
      flush()
      const sentences = para.match(/[^.!?]+[.!?]+|\S+$/g) ?? [para]
      for (const sentence of sentences) {
        if (current.length + sentence.length > TARGET_CHUNK_CHARS && current.length > 0) {
          const carry = current.slice(-CHUNK_OVERLAP_CHARS)
          flush()
          current = carry
        }
        current += sentence
      }
      flush()
      continue
    }

    if (current.length + para.length > TARGET_CHUNK_CHARS && current.length > 0) {
      const carry = current.slice(-CHUNK_OVERLAP_CHARS)
      flush()
      current = carry + '\n\n'
    }
    current += (current.length > 0 ? '\n\n' : '') + para
  }
  flush()

  return chunks
}

async function main() {
  console.log(`[ingest] fetching grounding source: ${KNOWLEDGE_SOURCE_URL}`)

  const res = await fetch(KNOWLEDGE_SOURCE_URL, {
    headers: { 'User-Agent': 'HeadroomBot/1.0 (+compliance copilot ingest)' },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch source (HTTP ${res.status} ${res.statusText})`)
  }

  const html = await res.text()
  const text = htmlToText(html)
  console.log(`[ingest] extracted ${text.length} chars of text`)

  if (text.length < 500) {
    console.warn(
      '[ingest] WARNING: very little text extracted. The page may be client-rendered ' +
        '(JS-gated). Verify the URL returns server-rendered article body, or supply the ' +
        'text another way before relying on retrieval.',
    )
  }

  const chunks = chunkText(text)
  console.log(`[ingest] split into ${chunks.length} chunks`)
  if (chunks.length === 0) {
    throw new Error('No chunks produced — aborting so we do not wipe an existing knowledge base.')
  }

  // Embed every chunk first (so a failure here doesn't leave us with a half-wiped table).
  console.log('[ingest] embedding chunks with all-MiniLM-L6-v2 (first run downloads the model)…')
  const rows: { content: string; embedding: number[]; source_url: string }[] = []
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i]!)
    rows.push({ content: chunks[i]!, embedding, source_url: KNOWLEDGE_SOURCE_URL })
    if ((i + 1) % 5 === 0 || i === chunks.length - 1) {
      console.log(`[ingest]   embedded ${i + 1}/${chunks.length}`)
    }
  }

  // Refresh: clear prior rows for this source, then insert the new set.
  console.log('[ingest] clearing previous rows for this source_url…')
  const { error: delErr } = await supabase
    .from('documents')
    .delete()
    .eq('source_url', KNOWLEDGE_SOURCE_URL)
  if (delErr) throw new Error(`Failed to clear existing rows: ${delErr.message}`)

  // pgvector accepts the array literal string '[..]' for the vector column.
  const insertRows = rows.map((r) => ({
    content: r.content,
    embedding: JSON.stringify(r.embedding),
    source_url: r.source_url,
  }))
  const { error: insErr } = await supabase.from('documents').insert(insertRows)
  if (insErr) throw new Error(`Failed to insert rows: ${insErr.message}`)

  console.log(`[ingest] done — ${rows.length} passages stored in documents.`)
}

main().catch((err) => {
  console.error('[ingest] failed:', err)
  process.exit(1)
})
