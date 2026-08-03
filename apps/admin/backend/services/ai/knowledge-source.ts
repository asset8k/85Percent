/**
 * knowledge-source — the single grounding source for the Co-pilot RAG.
 *
 * The official 2026/27 EFL/PL Handbook is not published yet, so the Co-pilot is
 * grounded STRICTLY on the Premier League's November 2025 explainer of the new
 * financial system. Both the ingest script (what we embed) and the system prompt
 * (what we tell the model + show the user) reference these constants so the
 * source can never drift between the two.
 */

export const KNOWLEDGE_SOURCE_URL =
  'https://www.premierleague.com/en/news/4467022/new-premier-league-financial-system-explained'

export const KNOWLEDGE_SOURCE_LABEL = 'November 2025 Premier League Financial System Explainer'
