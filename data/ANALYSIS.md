# Dataset analysis — AIE World's Fair 2026 (563 talks)

Generated from the talk embeddings + metadata (`scripts/03-analysis.mjs`,
full numbers in `analysis.json`). This is the "beyond the brief" pass: things
worth knowing before we design the front-end.

## Coverage
- **563 talks**, **455 with abstracts** (avg ~134 words), **108 without**.
- **47 tentative** ("To be announced" / placeholder) talks.
- 108 abstract-less talks are why pure keyword search feels thin — those rows
  have almost nothing to match against. The LLM keyphrase pass + title/speaker
  fallback embedding now give them *something* to be found by.

## The curated tags are too coarse for discovery
The 47 curated tags work as filters but collapse the corpus: `agents` is on
**342 / 563** talks and `design-engineering` on **332**. Searching or filtering
by them barely narrows anything. The new **3,287-keyphrase vocabulary** (5–9
specific phrases per talk, e.g. *speculative decoding, kv cache, event-sourced
systems, human-in-the-loop approval*) is the precision layer the tags lack.

## Heavy duplication / series (21 near-identical groups, ~50 talks)
Embeddings at cosine ≥ 0.92 reveal repeated/serialized sessions:
- `Claude Managed Agents Workshop (Part 1)` ×4, `Everybody Gets a Digital Clone!`
  ×3, `Build realtime multimodal agents with Gemini Live` ×3, `Local AI: …`
  reruns, `Forward Deployed Engineering is done at <company>` ×8, multiple
  `To be announced`.
- **Implication:** the map and "similar talks" must visibly *group* these
  rather than show them as separate dots, and search should de-dupe series so
  one query doesn't return the same talk five times.

## Natural topic structure — 20 clusters
k-means over the embeddings produces clean, nameable clusters (labels in
`vectors.js`). Highlights: *LLM Inference & Serving at Scale (35)*, *Agent
Platforms & Orchestration (87, the catch-all)*, *Agent Evals & Observability
(53)*, *Agentic Architecture for AI-Native Systems (61)*, *Enterprise AI
Adoption & Governance (40)*, *Context Engineering & Memory*, *Voice & Realtime
Multimodal*, *Search/Retrieval & AutoResearch*, *Forward-Deployed Engineering*,
*MCP & Generative UI*, *Local & On-Device AI*. These become the colored
regions / filter chips on the visual map.

## Most distinctive vs most generic talks
Lowest mean-similarity (genuinely unique angles): *transformer-only ASICs for
inference*, *SOTA Generative Media Panel*, *Neo4J L&L*, *AI gave an embodied
900-pin shape display a body*. The densest, most "central" talks are the
generic agent-platform / agentic-coding sessions — useful signal for a
"surprise me / off the beaten path" discovery mode.

## Speakers & orgs
- **526 unique speakers**, **318 unique orgs**; **49 talks have no listed speaker**.
- Top orgs: **Anthropic (19), OpenAI (17), Microsoft (17), Google DeepMind (12)**,
  McKinsey (8), Google (7), Arize (6), Together AI (6), AWS (6).
- An org/speaker facet is viable and would be popular (e.g. "all Anthropic talks").

## Schedule is dense — conflicts are the real user problem
- **71 distinct start times**; up to **17 talks run concurrently**.
- Busiest slots cluster midday on Session Days 2–3.
- Session distribution is even across the 3 session days (~130 each) with
  workshops isolated on Day 1.
- **Implication:** discovery isn't just "find a talk", it's "find the best
  talk *in this slot*" and "what am I missing while in this one". Semantic
  similarity + slot awareness enables "while you're in X, the 3 closest talks
  you're missing are …" and conflict-aware recommendations.

## Takeaways for the front-end
1. Hybrid search (lexical over keyphrases/entities + semantic vectors) — not
   one or the other.
2. De-duplicate series in results and group them on the map.
3. Use the 20 clusters as the map's colored, filterable regions.
4. Lean into slot-conflict-aware recommendations — the schedule density makes
   "what am I trading off" the highest-value discovery feature.
