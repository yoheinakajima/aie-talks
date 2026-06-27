# AI Engineer World's Fair 2026 — Talk Explorer

A fast, minimalist, **fully client-side** explorer for all 563 talks at the AI Engineer World's Fair 2026. Ask in plain English, filter and sort every which way, favorite talks into a personal schedule, and export it to your calendar — all with no backend.

Open `index.html` in any browser, or host the folder on any static host (GitHub Pages, Netlify, S3…). There is no build step.

## Features

### 🔎 Ask bar (natural-language search)
Type things like:
- *“voice agents on day 2 in the afternoon, sorted by time”*
- *“RAG and retrieval keynotes”*
- *“short lightning talks on security”*

The query is translated into structured filters + a relevance search and applied to the list, with a transparent banner showing how it was interpreted.

- **Works out of the box** with an on-device parser (synonyms, days, times, types, durations, tracks, tags, sort, view, favorites) — no key, no network.
- **Optional Claude upgrade**: add an Anthropic API key in *Settings* to have `claude-haiku-4-5` interpret free-form requests. The key is stored only in your browser and called directly from the page; it gracefully falls back to the on-device parser if anything fails.

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
| `app.js` | All behavior (search, filters, views, favorites, export) |
| `data.js` | The 563 talks + facet indexes, embedded as `window.AIEWF` |

`data.js` is generated from the official schedule JSON; embedding it as a JS global keeps the app working from `file://` without any server or CORS setup.

## Privacy
Everything runs locally in your browser. The only optional outbound request is to `api.anthropic.com`, and only if you supply your own API key and enable Claude search.
