# Search & Discovery Overhaul — front-end plan

Builds on the new data layer (`data/vectors.js`, `data/enriched.js`). Keeps the
project **fully static, zero-build, no backend**. Nothing here requires an API
key; the only optional network call is a one-time model download on the user's
own machine.

## 1. Hybrid search (replaces substring-only ranking)

Two signals, fused — neither alone is enough:

- **Lexical** (instant, offline): extend the existing `scoreTalk()` blob to
  include the new **keyphrases, entities, and summary**, plus typo tolerance.
  This alone massively improves precision (3,287 specific phrases vs 47 coarse
  tags) and already gives the 108 abstract-less talks something to match.
- **Semantic** (vector): embed the user's query in-browser with
  **Transformers.js (`Xenova/all-MiniLM-L6-v2`)** — the *same* model the corpus
  was built with — and cosine-rank against the int8 vectors in `vectors.js`.
- **Fusion:** Reciprocal Rank Fusion of the two ranked lists → one ordering.
  When lexical returns little/nothing, show a **"Closest matches"** section
  from the semantic side. This is the direct fix for *"event sourcing"* →
  *"Let's integrate AI Agents in Event-Sourced Systems"* (verified).

**Loading strategy**
- `data.js` + `enriched.js` (165 KB): eager — powers lexical search immediately.
- `vectors.js` (447 KB): lazy — fetched on first map open or first semantic
  query.
- Transformers.js model (~25 MB): lazy, cached by the browser after first use.
  Until it loads (or if offline), search runs lexical-only and degrades
  gracefully — same pattern as today's optional Claude key. A small toggle/
  indicator shows "semantic on/loading/offline".

## 2. Visual vector map (new 5th view)

A `<canvas>` scatter of the precomputed UMAP coords (`vectors.js.coords`) — no
runtime embedding needed, so it's instant and works offline.

- **Color encoding toggle:** by cluster (the 20 labeled regions) · type · day ·
  tag. Legend doubles as a filter.
- **Hover:** tooltip with title, speakers, time/room, and the one-line summary.
- **Click:** opens the existing detail drawer.
- **Live filtering:** day / type / time / length / tag filters dim or drop
  non-matching points in place (reuses `filterTalks` state) — so "filter the
  map by event type and date" works exactly as you described.
- **Cluster labels** float at each cluster centroid; clicking one filters to it.
- **Search integration:** matching points highlight/pulse; optional "zoom to
  results".
- **"Find similar":** from a hovered/selected talk, light up its top-8 neighbors
  (`vectors.js.neighbors`).
- **Lasso / box select** → add the selection to **My Events** or filter to it.
- **De-dupe:** near-duplicate series (see ANALYSIS.md) render as a single
  clustered glyph with a count, so reruns don't clutter.

Rendering 563 points on canvas is trivial; if we want buttery zoom/pan we can
add a tiny WebGL scatter later, but plain canvas is enough for v1.

## 3. "More like this" everywhere
- Detail drawer gains a **Related talks** strip from precomputed neighbors
  (zero network).
- Optional **schedule-aware rec:** given My Events, suggest semantically close
  talks in **non-conflicting** slots — the schedule is dense (up to 17
  concurrent), so "what am I trading off / what's the best talk in this slot"
  is the highest-value discovery feature (see ANALYSIS.md).

## 4. Smaller wins
- Keyphrase **chips** become first-class: clickable, autosuggest as you type.
- "No exact match → here's what's semantically closest" banner.
- Summaries used in card previews and map tooltips.
- Org/speaker facet (526 speakers, 318 orgs) — e.g. "all Anthropic talks".

## 5. Code touch-points in `app.js`
- Extend the search blob + `scoreTalk()` to read `AIEWF_ENRICH`.
- New `semantic.js` module: lazy model load, query embed, int8 decode, cosine,
  RRF fusion.
- New map view: render fn + interaction handlers, wired into the existing
  view-switcher and filter state.
- Drawer: add Related-talks strip from `AIEWF_VEC.neighbors`.
- Asset loader: lazy-inject `vectors.js` and Transformers.js on demand.

## Open questions for build phase
1. Map polish level for v1 — basic interactive scatter vs. full lasso-to-
   schedule.
2. Ship Transformers.js from a CDN (smaller repo, needs network first use) vs.
   vendored locally (bigger repo, works from `file://` offline).
3. Whether to also add the org/speaker facet now or defer.
