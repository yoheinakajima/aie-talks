# AI Engineer World's Fair 2026 — Talk Explorer

A fast, minimalist, **fully client-side** explorer for all 563 talks at the AI Engineer World's Fair 2026. Ask in plain English, filter and sort every which way, favorite talks into a personal schedule, and export it to your calendar — all with no backend.

Open `index.html` in any browser, or host the folder on any static host (GitHub Pages, Netlify, S3…). There is no build step.

## Features

### 🔎 Ask bar (natural-language + semantic search)
Type things like:
- *“event sourcing”* · *“keeping humans in the loop”* · *“making models cheaper and faster”*
- *“voice agents on day 2 in the afternoon, sorted by time”*
- *“short lightning talks on security”*

The query is translated into structured filters + a hybrid relevance search, with a transparent banner showing how it was interpreted.

- **Hybrid ranking**: a keyword scorer (over titles, speakers, tags, and LLM-extracted keyphrases) is fused with **in-browser semantic search** via Reciprocal Rank Fusion — so a query like *“event sourcing”* surfaces relevant talks even with no exact word match. Semantic-only hits are flagged *✦ related*.
- **Fully on-device**: the embedding model (`all-MiniLM-L6-v2`, ~25 MB) loads from a CDN on first semantic search and is cached; corpus vectors ship pre-computed in `data/vectors.js`. Works with no key. Toggle it in *Settings*; it degrades to keyword search while loading or offline.
- **Optional Claude upgrade**: add an Anthropic API key in *Settings* to have `claude-haiku-4-5` interpret free-form requests. Stored only in your browser; falls back to the on-device parser.

### 🗺 Vector map (cluster explorer)
A 2-D map of all 563 talks projected from their embeddings (UMAP), so semantically similar talks sit together.
- **Color** by theme cluster (20 auto-labeled regions), talk type, or day; legend entries toggle visibility.
- **Hover** for a summary, **click** to open the talk, hover to see its nearest neighbors linked.
- Sidebar **filters and search dim the map live**; **lasso-select** talks to add them to My Events or filter to them.
- Zoom (scroll) and pan (drag); fully offline once `data/vectors.js` is loaded.

### 🔗 More like this
Every talk's detail drawer shows its **theme cluster** and a **Related talks** strip (precomputed nearest neighbors), plus clickable **key topics** that launch a new search.

### 🎛 Rich filtering & sorting
- **Day** · **Type** (keynote / session / workshop / sponsor / special) · **Time of day** · **Length** · **Track topic** · **Room / stage** · **Tags** (searchable) · **Speaker / org** · quick toggles (favorites-only, has-abstract, hide-tentative).
- Filters combine with live, removable chips and a result counter.
- **Sort** by time, relevance, title, duration, or track.

### 🗂 Four views
- **Agenda** — grouped by day with time rails (default)
- **List** — rich cards with abstract previews
- **Grid** — responsive card gallery
- **Compact** — dense scannable rows

### ⭐ My Events (personal schedule)
- Bookmark any talk; saved in `localStorage` (survives reloads, per-browser).
- Grouped-by-day schedule with **time-conflict detection**.
- **Export**: copy as Markdown, download Markdown / JSON, or a **`.ics` calendar** (with `America/Los_Angeles` timezone) you can import into Google/Apple/Outlook Calendar.

### ✨ Details
- Click any talk for a drawer with the full abstract, speakers, room, track and tags.
- Light / dark theme (respects system preference), responsive down to mobile, keyboard shortcuts (`/` to focus search, `Esc` to close).

## Files
| File | Purpose |
| --- | --- |
| `index.html` | Markup & layout |
| `styles.css` | Design system & responsive styles |
| `app.js` | All behavior (hybrid search, filters, views, vector map, favorites, export) |
| `data.js` | The 563 talks + facet indexes, embedded as `window.AIEWF` |
| `data/enriched.js` | LLM keyphrases, entities & summaries per talk (`window.AIEWF_ENRICH`) |
| `data/vectors.js` | Quantized embeddings, map coords, clusters, neighbors (`window.AIEWF_VEC`, lazy-loaded) |
| `scripts/` | Offline build pipeline that generates the `data/` artifacts (see `scripts/README.md`) |

`data.js` is generated from the official schedule JSON; embedding it as a JS global keeps the app working from `file://` without any server or CORS setup.

## Privacy
Everything runs locally in your browser. The only optional outbound request is to `api.anthropic.com`, and only if you supply your own API key and enable Claude search.
