/* ============================================================
   AI Engineer World's Fair 2026 — Talk Explorer
   Vanilla JS. No build step. Works from file:// or static host.
   ============================================================ */
(function () {
"use strict";

const DATA = window.AIEWF || { talks: [], facets: {}, conference: {} };
const TALKS = DATA.talks;
const FACETS = DATA.facets;
const CONF = DATA.conference;
const LS = {
  favs: "aiewf:favs", theme: "aiewf:theme", view: "aiewf:view",
  apikey: "aiewf:apikey", useLLM: "aiewf:useLLM",
};

/* ---------- persistence helpers ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- state ---------- */
const favs = new Set(store.get(LS.favs, []));
const state = {
  search: "",
  days: new Set(), types: new Set(), topics: new Set(),
  locations: new Set(), tags: new Set(),
  times: new Set(), durations: new Set(),
  speaker: "",
  favOnly: false, hasAbstract: false, hideTentative: false,
  sort: "time",
  view: store.get(LS.view, "agenda"),
  interpretation: null,
};

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  askInput: $("ask-input"), askGo: $("ask-go"), askClear: $("ask-clear"),
  askSuggest: $("ask-suggest"),
  sort: $("sort-select"), viewSwitch: $("view-switch"),
  results: $("results"), empty: $("empty-state"), resultCount: $("result-count"),
  filterPanels: $("filter-panels"), chipBar: $("chip-bar"),
  interpretBanner: $("interpret-banner"),
  sidebar: $("sidebar"), sidebarScrim: $("sidebar-scrim"),
  activeFilterCount: $("active-filter-count"),
  favCount: $("fav-count"),
  detailDrawer: $("detail-drawer"), detailScrim: $("detail-scrim"),
  myEventsDrawer: $("myevents-drawer"), myEventsScrim: $("myevents-scrim"),
  myEventsBody: $("myevents-body"), myEventsSub: $("myevents-sub"),
  settingsScrim: $("settings-scrim"), apikeyInput: $("apikey-input"),
  useLLMToggle: $("use-llm-toggle"), settingsStatus: $("settings-status"),
  toast: $("toast"),
};

/* ============================================================
   TIME / DURATION HELPERS
   ============================================================ */
function parseTimeToMin(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let h = +m[1]; const min = +m[2]; const mer = m[3].toLowerCase();
  if (mer === "pm" && h !== 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h * 60 + min;
}
function timeBucket(t) {
  const mm = parseTimeToMin(t);
  if (mm == null) return null;
  if (mm < 12 * 60) return "morning";
  if (mm < 17 * 60) return "afternoon";
  return "evening";
}
const TIME_BUCKETS = [
  { key: "morning", label: "Morning", hint: "before noon" },
  { key: "afternoon", label: "Afternoon", hint: "12–5pm" },
  { key: "evening", label: "Evening", hint: "after 5pm" },
];
function durBucket(d) {
  if (d == null) return null;
  if (d <= 15) return "lightning";
  if (d <= 45) return "standard";
  if (d <= 90) return "long";
  return "workshop";
}
const DUR_BUCKETS = [
  { key: "lightning", label: "Lightning", hint: "≤15 min" },
  { key: "standard", label: "Standard", hint: "16–45 min" },
  { key: "long", label: "Long talk", hint: "46–90 min" },
  { key: "workshop", label: "Workshop", hint: "90 min+" },
];
function fmtDur(d) {
  if (d == null) return "";
  if (d < 60) return d + "m";
  const h = Math.floor(d / 60), m = d % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function shortDay(label) {
  if (!label) return "";
  return label.replace("Session Day", "Day").replace("Workshop Day", "Workshops");
}

/* ============================================================
   RELEVANCE SEARCH  (client-side weighted scoring)
   ============================================================ */
const STOP = new Set("the a an and or of to for in on at with about from into over how why what is are be all me show find talk talks session sessions event events".split(" "));
function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9+#\s-]/g, " ").split(/\s+/).filter(w => w && w.length > 1 && !STOP.has(w));
}
// pre-build a lightweight search blob per talk
TALKS.forEach(t => {
  t._blob = [
    t.title, t.title, // weight title
    t.spk.join(" "),
    (t.speakers || []).map(s => s.o).join(" "),
    t.topic || "", (t.tags || []).map(x => x.replace(/-/g, " ")).join(" "),
    t.abstract,
  ].join(" \n ").toLowerCase();
  t._title_l = (t.title || "").toLowerCase();
});
function scoreTalk(talk, terms) {
  if (!terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    const inTitle = talk._title_l.includes(term);
    if (inTitle) score += 8;
    if ((talk.tags || []).some(tg => tg.includes(term))) score += 5;
    if ((talk.topic || "").toLowerCase().includes(term)) score += 4;
    if (talk.spk.join(" ").toLowerCase().includes(term)) score += 5;
    if (talk.abstract && talk.abstract.toLowerCase().includes(term)) score += 1.5;
  }
  // phrase bonus
  return score;
}

/* ============================================================
   LOCAL NATURAL-LANGUAGE PARSER
   ============================================================ */
const TAG_KEYS = (FACETS.tags || []).map(t => t.key);
const TOPIC_KEYS = (FACETS.topics || []).map(t => t.key);
const LOC_KEYS = (FACETS.locations || []).map(t => t.key);

// keyword -> tag mapping (synonyms)
const SYN = [
  [/\bvoice|speech|realtime|audio\b/, { tags: ["voice-ai"] }],
  [/\brag\b|retriev|search|vector|embedding/, { tags: ["retrieval-search", "search-retrieval"] }],
  [/\bagent|agentic|autonom/, { tags: ["agents"] }],
  [/\beval|evaluation|benchmark|testing/, { tags: ["evals"] }],
  [/\bsecurit|safety|guardrail|jailbreak|red.?team/, { tags: ["security"] }],
  [/\brobot|world model|embodi/, { tags: ["robotics-world-models"] }],
  [/\bmemory|context window|continual/, { tags: ["memory-context", "memory-continual-learning", "context-engineering"] }],
  [/\bmultimodal|vision|image|ocr|video\b/, { tags: ["vision-multimodal", "vision-ocr"] }],
  [/\bvoice\b/, { tags: ["voice-ai"] }],
  [/\bgraph|knowledge graph|neo4j/, { tags: ["graphs"] }],
  [/\binference|serving|latency|throughput|gpu|kernel/, { tags: ["inference"] }],
  [/\blocal|on.?device|edge|offline|ollama/, { tags: ["local-ai"] }],
  [/\benterprise|fortune|b2b/, { tags: ["enterprise-ai", "ai-native-enterprises"] }],
  [/\bfinance|fintech|trading|bank/, { tags: ["finance", "ai-in-finance"] }],
  [/\bhealth|medical|clinical|bio/, { tags: ["healthcare", "ai-in-healthcare"] }],
  [/\bgenerative media|gen media|diffusion|music|3d\b/, { tags: ["generative-media"] }],
  [/\bdesign|ux|frontend|front.?end|interface/, { tags: ["design-engineering"] }],
  [/\bdata quality|labeling|annotation|dataset/, { tags: ["data-quality"] }],
  [/\bcommerce|payment|shopping|checkout/, { tags: ["commerce-payments", "agentic-commerce"] }],
  [/\bpost.?train|rl\b|reinforcement|fine.?tun|midtrain/, { tags: ["posttraining-rl", "posttraining-midtraining"] }],
  [/\bcoding|code|software|developer|devtool|ide\b/, { tags: ["software-engineering", "software-factories"] }],
  [/\bcompute use|computer.?use|browser use/, { tags: ["computer-use"] }],
  [/\bgtm|sales|marketing|growth/, { tags: ["ai-in-gtm"] }],
  [/\bresearch|autoresearch|science/, { tags: ["autoresearch"] }],
  [/\bharness|orchestrat|workflow/, { tags: ["harness-engineering"] }],
  [/\bsandbox|platform engineer|infra/, { tags: ["sandbox-platform-engineering"] }],
  [/\bpersonal agent|claws|assistant\b/, { tags: ["claws-personal-agents"] }],
];

const DAY_MAP = [
  [/\bday\s*1\b|workshop day|first day|monday|june 29|6\/29/, "Workshop Day"],
  [/\bday\s*2\b|session day 1|second day|tuesday|june 30|6\/30/, "Session Day 1"],
  [/\bday\s*3\b|session day 2|third day|wednesday|july 1|7\/1/, "Session Day 2"],
  [/\bday\s*4\b|session day 3|fourth day|last day|thursday|july 2|7\/2/, "Session Day 3"],
];

function localParse(qRaw) {
  const q = " " + qRaw.toLowerCase() + " ";
  const spec = { search: "", days: [], types: [], topics: [], tags: [], times: [], durations: [], speaker: "", sort: null, view: null, favOnly: false };
  let consumed = qRaw.toLowerCase();
  const eat = (re) => { consumed = consumed.replace(re, " "); };

  // days
  DAY_MAP.forEach(([re, label]) => { if (re.test(q)) { spec.days.push(label); eat(re); } });
  // time of day
  if (/\bmorning|before noon|am\b/.test(q)) { spec.times.push("morning"); eat(/morning|before noon/g); }
  if (/\bafternoon|after lunch|midday\b/.test(q)) { spec.times.push("afternoon"); eat(/afternoon|after lunch|midday/g); }
  if (/\bevening|night|after 5|reception|happy hour\b/.test(q)) { spec.times.push("evening"); eat(/evening|night|reception|happy hour/g); }
  // types
  if (/\bkeynote/.test(q)) { spec.types.push("KEYNOTE"); eat(/keynotes?/g); }
  if (/\bworkshop/.test(q)) { spec.types.push("WORKSHOP"); eat(/workshops?/g); }
  if (/\bsponsor/.test(q)) { spec.types.push("SPONSOR"); eat(/sponsors?/g); }
  if (/\bpanel|fireside|special event/.test(q)) { spec.types.push("SPECIAL_EVENT"); eat(/panels?|firesides?|special events?/g); }
  if (/\bregular session|breakout|standard talk/.test(q)) { spec.types.push("SESSION"); }
  // duration
  if (/\blightning|quick|short|brief|5.?min|10.?min/.test(q)) { spec.durations.push("lightning"); eat(/lightning|quick|brief/g); }
  if (/\blong talk|deep dive|in.?depth/.test(q)) { spec.durations.push("long"); eat(/deep dive/g); }
  // sort
  if (/sort.*time|chronolog|by time|earliest|schedule order/.test(q)) spec.sort = "time";
  if (/alphabetic|by title|a-z|a to z/.test(q)) spec.sort = "title";
  if (/shortest|short.*first/.test(q)) spec.sort = "durAsc";
  if (/longest|long.*first/.test(q)) spec.sort = "durDesc";
  if (/most relevant|best match/.test(q)) spec.sort = "relevance";
  // view
  if (/\bgrid\b/.test(q)) spec.view = "grid";
  if (/\bcompact|dense|table\b/.test(q)) spec.view = "compact";
  if (/\bagenda|by day|timeline\b/.test(q)) spec.view = "agenda";
  // favorites
  if (/my favorite|favourited|favorited|my events|saved|my schedule/.test(q)) spec.favOnly = true;

  // topic exact-ish match
  TOPIC_KEYS.forEach(tk => { if (q.includes(tk.toLowerCase())) spec.topics.push(tk); });

  // synonyms -> tags
  const addTag = (t) => { if (TAG_KEYS.includes(t) && !spec.tags.includes(t)) spec.tags.push(t); };
  SYN.forEach(([re, act]) => { if (re.test(q)) (act.tags || []).forEach(addTag); });

  // "by <name>" speaker
  const sp = qRaw.match(/\b(?:by|from|speaker|with)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})/);
  if (sp) spec.speaker = sp[1];

  // remaining words become relevance search
  const leftover = tokenize(consumed).filter(w => !["sort","by","day","talks","talk","show","find","afternoon","morning","evening"].includes(w));
  // If we matched specific tags/topics, still keep meaningful leftover words for search
  spec.search = leftover.join(" ").trim();

  // Build human note
  const parts = [];
  if (spec.search) parts.push(`matching “<b>${escapeHtml(spec.search)}</b>”`);
  if (spec.tags.length) parts.push("tagged " + spec.tags.map(t => "<b>" + tagLabel(t) + "</b>").join(", "));
  if (spec.topics.length) parts.push("track " + spec.topics.map(t => "<b>" + escapeHtml(t) + "</b>").join(", "));
  if (spec.types.length) parts.push(spec.types.map(t => "<b>" + typeLabel(t) + "</b>").join(", "));
  if (spec.days.length) parts.push("on " + spec.days.map(d => "<b>" + d + "</b>").join(", "));
  if (spec.times.length) parts.push("in the " + spec.times.map(t => "<b>" + t + "</b>").join("/"));
  if (spec.durations.length) parts.push(spec.durations.map(d => "<b>" + d + "</b>").join(", "));
  if (spec.speaker) parts.push("speaker <b>" + escapeHtml(spec.speaker) + "</b>");
  if (spec.favOnly) parts.push("from <b>your favorites</b>");
  spec.note = parts.length ? "Showing talks " + parts.join(" · ") : "";
  return spec;
}

/* ============================================================
   LLM PARSER (optional, Anthropic direct browser call)
   ============================================================ */
async function llmParse(qRaw) {
  const key = store.get(LS.apikey, "");
  if (!key) throw new Error("no key");
  const sys = buildLLMSystemPrompt();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system: sys,
      messages: [{ role: "user", content: qRaw }],
    }),
  });
  if (!res.ok) throw new Error("api " + res.status);
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || "").join("");
  const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const spec = JSON.parse(jsonStr);
  return normalizeLLMSpec(spec, qRaw);
}
function buildLLMSystemPrompt() {
  return `You convert a user's natural-language request about conference talks into a JSON filter spec.
The conference is the AI Engineer World's Fair 2026 (4 days).
Return ONLY a JSON object, no prose. Schema:
{
 "search": string,           // free-text topical keywords for relevance search (omit day/type words)
 "days": string[],           // any of: "Workshop Day","Session Day 1","Session Day 2","Session Day 3"
 "types": string[],          // any of: "KEYNOTE","SESSION","WORKSHOP","SPONSOR","SPECIAL_EVENT"
 "tags": string[],           // any of these tag keys: ${TAG_KEYS.join(", ")}
 "topics": string[],         // any of these exact track topics: ${TOPIC_KEYS.join(" | ")}
 "times": string[],          // any of: "morning","afternoon","evening"
 "durations": string[],      // any of: "lightning","standard","long","workshop"
 "speaker": string,          // a speaker or organization name if specified
 "sort": string,             // one of: "time","relevance","title","durAsc","durDesc","track" or ""
 "view": string,             // one of: "agenda","list","grid","compact" or ""
 "favOnly": boolean,
 "note": string              // a short friendly summary of how you interpreted the request
}
Map day numbers: "day 1"->Workshop Day, "day 2"->Session Day 1, "day 3"->Session Day 2, "day 4"->Session Day 3.
Choose the closest tags/topics from the allowed lists. Leave arrays empty when not implied. Be generous matching synonyms (voice=voice-ai, rag=retrieval-search, etc).`;
}
function normalizeLLMSpec(s, qRaw) {
  const arr = (x) => Array.isArray(x) ? x : (x ? [x] : []);
  const spec = {
    search: typeof s.search === "string" ? s.search : "",
    days: arr(s.days).filter(d => DAY_MAP.some(([, l]) => l === d)),
    types: arr(s.types).filter(t => ["KEYNOTE","SESSION","WORKSHOP","SPONSOR","SPECIAL_EVENT"].includes(t)),
    tags: arr(s.tags).filter(t => TAG_KEYS.includes(t)),
    topics: arr(s.topics).filter(t => TOPIC_KEYS.includes(t)),
    times: arr(s.times).filter(t => ["morning","afternoon","evening"].includes(t)),
    durations: arr(s.durations).filter(t => ["lightning","standard","long","workshop"].includes(t)),
    speaker: typeof s.speaker === "string" ? s.speaker : "",
    sort: ["time","relevance","title","durAsc","durDesc","track"].includes(s.sort) ? s.sort : null,
    view: ["agenda","list","grid","compact"].includes(s.view) ? s.view : null,
    favOnly: !!s.favOnly,
    note: typeof s.note === "string" ? s.note : "",
  };
  if (!spec.note) { const l = localParse(qRaw); spec.note = l.note; }
  return spec;
}

/* ============================================================
   APPLY A SPEC  (from ask bar)
   ============================================================ */
function applySpec(spec, source) {
  // reset filter sets that the spec controls; keep nothing stale
  state.search = spec.search || "";
  state.days = new Set(spec.days || []);
  state.types = new Set(spec.types || []);
  state.tags = new Set(spec.tags || []);
  state.topics = new Set(spec.topics || []);
  state.times = new Set(spec.times || []);
  state.durations = new Set(spec.durations || []);
  state.speaker = spec.speaker || "";
  state.favOnly = !!spec.favOnly;
  if (spec.sort) state.sort = spec.sort;
  else if (state.search) state.sort = "relevance";
  if (spec.view) setView(spec.view, false);
  state.interpretation = spec.note ? { note: spec.note, source } : null;
  els.sort.value = state.sort;
  syncFilterUI();
  render();
}

/* ============================================================
   FILTERING + SORTING
   ============================================================ */
function activeFilterTotal() {
  return state.days.size + state.types.size + state.topics.size + state.locations.size +
    state.tags.size + state.times.size + state.durations.size +
    (state.speaker ? 1 : 0) + (state.favOnly ? 1 : 0) +
    (state.hasAbstract ? 1 : 0) + (state.hideTentative ? 1 : 0);
}
function filterTalks() {
  const terms = tokenize(state.search);
  const spkQ = state.speaker.toLowerCase().trim();
  const out = [];
  for (const t of TALKS) {
    if (state.days.size && !state.days.has(t.dayLabel)) continue;
    if (state.types.size && !state.types.has(t.type)) continue;
    if (state.topics.size && !state.topics.has(t.topic)) continue;
    if (state.locations.size && !state.locations.has(t.loc)) continue;
    if (state.tags.size) { if (!(t.tags || []).some(tg => state.tags.has(tg))) continue; }
    if (state.times.size && !state.times.has(timeBucket(t.start))) continue;
    if (state.durations.size && !state.durations.has(durBucket(t.dur))) continue;
    if (state.favOnly && !favs.has(t.id)) continue;
    if (state.hasAbstract && !t.abstract) continue;
    if (state.hideTentative && t.tent) continue;
    if (spkQ) {
      const hay = (t.spk.join(" ") + " " + (t.speakers || []).map(s => s.o).join(" ")).toLowerCase();
      if (!hay.includes(spkQ)) continue;
    }
    let score = 0;
    if (terms.length) { score = scoreTalk(t, terms); if (score <= 0) continue; }
    out.push({ t, score });
  }
  sortResults(out, terms.length > 0);
  return out;
}
function sortResults(arr, hasSearch) {
  const byTime = (a, b) => (a.t.startDT || "").localeCompare(b.t.startDT || "") || a.t.sequence - b.t.sequence;
  const sorters = {
    relevance: (a, b) => b.score - a.score || byTime(a, b),
    time: byTime,
    title: (a, b) => a.t.title.localeCompare(b.t.title),
    durAsc: (a, b) => (a.t.dur || 0) - (b.t.dur || 0) || byTime(a, b),
    durDesc: (a, b) => (b.t.dur || 0) - (a.t.dur || 0) || byTime(a, b),
    track: (a, b) => (a.t.loc || "~").localeCompare(b.t.loc || "~") || byTime(a, b),
  };
  let key = state.sort;
  if (key === "relevance" && !hasSearch) key = "time";
  arr.sort(sorters[key] || byTime);
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const results = filterTalks();
  renderResultCount(results.length);
  renderChips();
  renderInterpretation();
  renderFavCount();
  updateFilterCheckStates();

  const terms = tokenize(state.search);
  if (results.length === 0) {
    els.results.innerHTML = "";
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  els.results.className = "results view-" + state.view;

  if (state.view === "agenda") renderAgenda(results, terms);
  else els.results.innerHTML = results.map(r => cardHTML(r.t, terms)).join("");
  bindCards();
}

function renderAgenda(results, terms) {
  // group by day, then time slot
  const byDay = new Map();
  for (const r of results) {
    if (!byDay.has(r.t.dayLabel)) byDay.set(r.t.dayLabel, []);
    byDay.get(r.t.dayLabel).push(r);
  }
  const dayOrder = ["Workshop Day", "Session Day 1", "Session Day 2", "Session Day 3"];
  const dayMeta = {};
  (FACETS.days || []).forEach(d => dayMeta[d.label] = d);
  let html = "";
  const sortedDays = [...byDay.keys()].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
  for (const day of sortedDays) {
    const items = byDay.get(day);
    const meta = dayMeta[day] || {};
    html += `<section class="day-group"><div class="day-header"><h2>${escapeHtml(day)}</h2>` +
      `<span class="dh-date">${meta.date ? fmtDate(meta.date) : ""}</span>` +
      `<span class="dh-count">${items.length} talk${items.length !== 1 ? "s" : ""}</span></div>`;
    // when sorting by time, add time rails
    if (state.sort === "time") {
      let lastSlot = null;
      for (const r of items) {
        const slot = r.t.start || "";
        if (slot !== lastSlot) { html += `<div class="time-rail">${escapeHtml(slot)}</div>`; lastSlot = slot; }
        html += cardHTML(r.t, terms);
      }
    } else {
      html += items.map(r => cardHTML(r.t, terms)).join("");
    }
    html += `</section>`;
  }
  els.results.innerHTML = html;
}

function highlight(text, terms) {
  let s = escapeHtml(text || "");
  if (!terms.length) return s;
  // build a single regex of terms
  const safe = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (!safe.length) return s;
  try {
    const re = new RegExp("(" + safe.join("|") + ")", "gi");
    s = s.replace(re, "<mark>$1</mark>");
  } catch {}
  return s;
}

function cardHTML(t, terms) {
  const isFav = favs.has(t.id);
  const topTags = (t.tags || []).slice(0, 4);
  const speakers = (t.speakers && t.speakers.length)
    ? t.speakers.map(s => `<span class="sp-name">${escapeHtml(s.n)}</span>${s.o ? ` · ${escapeHtml(s.o)}` : ""}`).join(`<span style="opacity:.4"> | </span>`)
    : (t.spk.length ? t.spk.map(escapeHtml).join(", ") : "");
  const badges = `<span class="badge t-${t.type}">${typeLabel(t.type)}</span>` +
    (t.topic ? `<span class="topic-pill">${escapeHtml(t.topic)}</span>` : "") +
    (t.tent ? `<span class="badge tentative">tentative</span>` : "");
  const room = t.loc ? `<span class="room-pill">${escapeHtml(t.loc)}</span>` : "";
  return `<article class="card${isFav ? " is-fav" : ""}" data-id="${t.id}">
    <div class="card-time">
      <div class="ct-day">${escapeHtml(shortDay(t.dayLabel))}</div>
      <div class="ct-start">${escapeHtml(t.start || "")}</div>
      <div class="ct-end">${t.end ? "– " + escapeHtml(t.end) : ""}</div>
      ${t.dur ? `<span class="ct-dur">${fmtDur(t.dur)}</span>` : ""}
      <span class="ct-room">${t.loc ? escapeHtml(t.loc) : ""}</span>
    </div>
    <div class="card-main">
      <div class="card-badges">${badges} ${room}</div>
      <h3 class="card-title">${highlight(t.title, terms)}</h3>
      ${speakers ? `<div class="card-speakers">${terms.length ? highlight(stripTags(speakers), terms) : speakers}</div>` : ""}
      ${t.abstract ? `<p class="card-abstract">${highlight(t.abstract.slice(0, 320), terms)}</p>` : ""}
      ${topTags.length ? `<div class="card-tags">${topTags.map(tg => `<span class="tagchip${state.tags.has(tg) ? " hot" : ""}">${escapeHtml(tagLabel(tg))}</span>`).join("")}</div>` : ""}
    </div>
    <button class="fav-btn${isFav ? " on" : ""}" data-fav="${t.id}" title="${isFav ? "Remove from My Events" : "Add to My Events"}" aria-label="Favorite">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
    </button>
  </article>`;
}
function stripTags(html) { return html.replace(/<[^>]+>/g, ""); }

function bindCards() {
  els.results.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav]")) return;
      openDetail(card.dataset.id);
    });
  });
  els.results.querySelectorAll("[data-fav]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(btn.dataset.fav); });
  });
}

function renderResultCount(n) {
  els.resultCount.innerHTML = `<b>${n}</b> of ${TALKS.length} talks`;
}

/* ---------- chips ---------- */
function renderChips() {
  const chips = [];
  const add = (cat, label, onRemove) => chips.push({ cat, label, onRemove });
  state.days.forEach(d => add("day", d, () => { state.days.delete(d); }));
  state.types.forEach(t => add("type", typeLabel(t), () => state.types.delete(t)));
  state.topics.forEach(t => add("track", t, () => state.topics.delete(t)));
  state.locations.forEach(l => add("room", l, () => state.locations.delete(l)));
  state.tags.forEach(t => add("tag", tagLabel(t), () => state.tags.delete(t)));
  state.times.forEach(t => add("time", t, () => state.times.delete(t)));
  state.durations.forEach(d => add("length", DUR_BUCKETS.find(x => x.key === d)?.label || d, () => state.durations.delete(d)));
  if (state.speaker) add("speaker", state.speaker, () => state.speaker = "");
  if (state.search) add("search", "“" + state.search + "”", () => state.search = "");
  if (state.favOnly) add("", "Favorites only", () => state.favOnly = false);
  if (state.hasAbstract) add("", "Has abstract", () => state.hasAbstract = false);
  if (state.hideTentative) add("", "Hide tentative", () => state.hideTentative = false);

  if (!chips.length) { els.chipBar.hidden = true; els.chipBar.innerHTML = ""; els.activeFilterCount.hidden = true; return; }
  els.chipBar.hidden = false;
  els.chipBar.innerHTML = chips.map((c, i) =>
    `<span class="fchip" data-chip="${i}">${c.cat ? `<span class="cat">${c.cat}</span>` : ""}${escapeHtml(c.label)}<span class="x" data-chip-x="${i}">×</span></span>`
  ).join("") + `<button class="text-btn" data-clear-chips>Clear all</button>`;
  els.chipBar.querySelectorAll("[data-chip-x]").forEach(x => x.addEventListener("click", () => {
    chips[+x.dataset.chipX].onRemove(); afterFilterChange();
  }));
  els.chipBar.querySelector("[data-clear-chips]")?.addEventListener("click", resetAll);

  const total = activeFilterTotal() + (state.search ? 1 : 0);
  els.activeFilterCount.hidden = total === 0;
  els.activeFilterCount.textContent = total;
}

function renderInterpretation() {
  const it = state.interpretation;
  if (!it || !it.note) { els.interpretBanner.hidden = true; els.interpretBanner.innerHTML = ""; return; }
  els.interpretBanner.hidden = false;
  const srcLabel = it.source === "llm" ? "Claude" : "smart parser";
  els.interpretBanner.innerHTML = `<div class="interpret-inner">
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/></svg>
    <div class="it-text">${it.note} <span class="it-src">· interpreted by ${srcLabel}</span></div>
    <button class="it-dismiss" title="Dismiss">×</button>
  </div>`;
  els.interpretBanner.querySelector(".it-dismiss").addEventListener("click", () => {
    state.interpretation = null; renderInterpretation();
  });
}

/* ============================================================
   FILTER SIDEBAR
   ============================================================ */
const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`;

function buildFilters() {
  const days = (FACETS.days || []).map(d => ({ key: d.label, label: d.label, count: d.count, sub: fmtDate(d.date) }));
  const types = (FACETS.types || []).map(t => ({ key: t.key, label: typeLabel(t.key), count: t.count }));
  const topics = (FACETS.topics || []).map(t => ({ key: t.key, label: t.key, count: t.count }));
  const locations = (FACETS.locations || []).map(t => ({ key: t.key, label: t.key, count: t.count }));
  const tags = (FACETS.tags || []).map(t => ({ key: t.key, label: t.label, count: t.count }));

  const panels = [
    panel("Day", "days", optsHTML("days", days)),
    panel("Type", "types", optsHTML("types", types)),
    panel("Time of day", "times", optsHTML("times", TIME_BUCKETS.map(b => ({ key: b.key, label: b.label, count: countBy(t => timeBucket(t.start) === b.key), sub: b.hint })))),
    panel("Length", "durations", optsHTML("durations", DUR_BUCKETS.map(b => ({ key: b.key, label: b.label, count: countBy(t => durBucket(t.dur) === b.key), sub: b.hint })))),
    panel("Track topic", "topics", `<div class="opt-scroll">${optsHTML("topics", topics)}</div>`),
    panel("Room / stage", "locations", `<div class="opt-scroll">${optsHTML("locations", locations)}</div>`, true),
    panel("Tags", "tags",
      `<input class="tag-search" id="tag-search" placeholder="Filter tags…" /><div class="opt-scroll" id="tag-opts">${optsHTML("tags", tags)}</div>`),
    panel("Speaker / org", "speaker", `<input class="tag-search" id="speaker-search" placeholder="e.g. OpenAI, Simon…" value="${escapeHtml(state.speaker)}" />`),
    panel("Quick toggles", "toggles", togglesHTML(), false),
  ];
  els.filterPanels.innerHTML = panels.join("");
  wireFilterEvents();
}

function panel(title, key, body, collapsed) {
  return `<div class="fpanel${collapsed ? " collapsed" : ""}" data-panel="${key}">
    <button class="fpanel-head" data-toggle-panel><span>${title}</span>
      <svg class="chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="fpanel-body">${body}</div></div>`;
}
function optsHTML(group, items) {
  return items.filter(i => i.count !== 0).map(i =>
    `<label class="opt"><input type="checkbox" data-group="${group}" value="${escapeHtml(i.key)}" />
      <span class="box">${CHECK_SVG}</span>
      <span class="lbl" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}${i.sub ? ` <span style="opacity:.6;font-size:11px">${escapeHtml(i.sub)}</span>` : ""}</span>
      <span class="cnt">${i.count}</span></label>`
  ).join("");
}
function togglesHTML() {
  const row = (id, label) => `<label class="toggle-opt"><span>${label}</span>
    <span class="switch"><input type="checkbox" data-toggle="${id}" /><span class="track"></span><span class="knob"></span></span></label>`;
  return row("favOnly", "⭐ Favorites only") + row("hasAbstract", "Has abstract") + row("hideTentative", "Hide tentative");
}
function countBy(fn) { let n = 0; for (const t of TALKS) if (fn(t)) n++; return n; }

function wireFilterEvents() {
  els.filterPanels.querySelectorAll("[data-toggle-panel]").forEach(b =>
    b.addEventListener("click", () => b.closest(".fpanel").classList.toggle("collapsed")));
  els.filterPanels.querySelectorAll("input[data-group]").forEach(inp =>
    inp.addEventListener("change", () => {
      const set = state[inp.dataset.group];
      if (inp.checked) set.add(inp.value); else set.delete(inp.value);
      afterFilterChange();
    }));
  els.filterPanels.querySelectorAll("input[data-toggle]").forEach(inp =>
    inp.addEventListener("change", () => { state[inp.dataset.toggle] = inp.checked; afterFilterChange(); }));
  const tagSearch = $("tag-search");
  if (tagSearch) tagSearch.addEventListener("input", () => {
    const q = tagSearch.value.toLowerCase();
    $("tag-opts").querySelectorAll(".opt").forEach(o => {
      o.style.display = o.querySelector(".lbl").textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
  const spk = $("speaker-search");
  if (spk) spk.addEventListener("input", debounce(() => { state.speaker = spk.value.trim(); afterFilterChange(false); }, 250));
  updateFilterCheckStates();
}
function syncFilterUI() { buildFilters(); }
function updateFilterCheckStates() {
  els.filterPanels.querySelectorAll("input[data-group]").forEach(inp => {
    inp.checked = state[inp.dataset.group].has(inp.value);
  });
  els.filterPanels.querySelectorAll("input[data-toggle]").forEach(inp => {
    inp.checked = !!state[inp.dataset.toggle];
  });
}
function afterFilterChange(rebuild = true) {
  // when user manually changes filters, clear the interpretation note
  render();
}

/* ============================================================
   FAVORITES / MY EVENTS
   ============================================================ */
function toggleFav(id, silent) {
  if (favs.has(id)) { favs.delete(id); }
  else { favs.add(id); if (!silent) toast("Added to My Events"); }
  store.set(LS.favs, [...favs]);
  renderFavCount();
  // update visible cards
  els.results.querySelectorAll(`[data-fav="${cssEsc(id)}"]`).forEach(b => {
    const on = favs.has(id); b.classList.toggle("on", on);
    b.closest(".card")?.classList.toggle("is-fav", on);
  });
  // update detail drawer if open
  const ddFav = els.detailDrawer.querySelector(`.dd-fav[data-fav="${cssEsc(id)}"]`);
  if (ddFav) { const on = favs.has(id); ddFav.classList.toggle("on", on); ddFav.querySelector("span").textContent = on ? "Saved to My Events" : "Add to My Events"; }
  if (state.favOnly) render();
  if (!els.myEventsDrawer.hidden) renderMyEvents();
}
function renderFavCount() {
  const n = favs.size;
  els.favCount.hidden = n === 0;
  els.favCount.textContent = n;
}

function favTalks() {
  return TALKS.filter(t => favs.has(t.id))
    .sort((a, b) => (a.startDT || "").localeCompare(b.startDT || ""));
}
function detectConflicts(list) {
  // returns Set of ids that overlap with another fav
  const conflicts = new Set();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.date !== b.date) continue;
      const as = parseDT(a.startDT), ae = parseDT(a.endDT), bs = parseDT(b.startDT), be = parseDT(b.endDT);
      if (as == null || bs == null) continue;
      const aEnd = ae == null ? as : ae, bEnd = be == null ? bs : be;
      if (as < bEnd && bs < aEnd) { conflicts.add(a.id); conflicts.add(b.id); }
    }
  }
  return conflicts;
}
function parseDT(s) { if (!s) return null; const m = s.match(/T(\d{2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; }

function renderMyEvents() {
  const list = favTalks();
  els.myEventsSub.textContent = list.length ? `${list.length} saved · ${new Set(list.map(t => t.dayLabel)).size} day(s)` : "Nothing saved yet";
  if (!list.length) {
    els.myEventsBody.innerHTML = `<div class="me-empty"><div class="em">🗓️</div><p>Tap the <strong>bookmark</strong> on any talk to start building your personal schedule.</p><p style="font-size:12px;margin-top:8px">It saves automatically in this browser.</p></div>`;
    return;
  }
  const conflicts = detectConflicts(list);
  const byDay = new Map();
  list.forEach(t => { if (!byDay.has(t.dayLabel)) byDay.set(t.dayLabel, []); byDay.get(t.dayLabel).push(t); });
  const dayOrder = ["Workshop Day", "Session Day 1", "Session Day 2", "Session Day 3"];
  let html = "";
  if (conflicts.size) html += `<div class="me-conflict"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>${conflicts.size} talk${conflicts.size > 1 ? "s have" : " has"} a time overlap</div>`;
  [...byDay.keys()].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)).forEach(day => {
    html += `<div class="me-day">${escapeHtml(day)}</div>`;
    byDay.get(day).forEach(t => {
      const conf = conflicts.has(t.id);
      html += `<div class="me-item">
        <div class="me-time">${escapeHtml(t.start || "")}${conf ? ` <span title="overlap" style="color:var(--amber)">⚠</span>` : ""}</div>
        <div class="me-info">
          <div class="me-title" data-open="${t.id}">${escapeHtml(t.title)}</div>
          <div class="me-sub">${t.loc ? escapeHtml(t.loc) + " · " : ""}${escapeHtml(typeLabel(t.type))}${t.spk.length ? " · " + escapeHtml(t.spk[0]) : ""}</div>
        </div>
        <button class="me-remove" data-rm="${t.id}" title="Remove">×</button>
      </div>`;
    });
  });
  els.myEventsBody.innerHTML = html;
  els.myEventsBody.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => toggleFav(b.dataset.rm, true)));
  els.myEventsBody.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => { closeMyEvents(); openDetail(b.dataset.open); }));
}

/* ---------- exports ---------- */
function exportMyEvents(kind) {
  const list = favTalks();
  if (!list.length && kind !== "clear") { toast("No saved events yet"); return; }
  if (kind === "clear") {
    if (!list.length) return;
    if (!confirm(`Remove all ${list.length} saved events?`)) return;
    favs.clear(); store.set(LS.favs, []); renderFavCount(); renderMyEvents();
    if (state.favOnly) render();
    toast("Cleared My Events"); return;
  }
  if (kind === "md") { downloadFile("my-aiewf-2026.md", toMarkdown(list), "text/markdown"); toast("Markdown downloaded"); }
  else if (kind === "json") { downloadFile("my-aiewf-2026.json", JSON.stringify(list.map(slimExport), null, 2), "application/json"); toast("JSON downloaded"); }
  else if (kind === "ics") { downloadFile("my-aiewf-2026.ics", toICS(list), "text/calendar"); toast("Calendar (.ics) downloaded"); }
  else if (kind === "copy") { copyText(toMarkdown(list)).then(() => toast("Copied to clipboard")); }
}
function slimExport(t) {
  return { title: t.title, day: t.dayLabel, date: t.date, start: t.start, end: t.end, room: t.loc, type: t.type, track: t.topic, speakers: t.spk, tags: t.tags };
}
function toMarkdown(list) {
  let md = `# My AI Engineer World's Fair 2026 Schedule\n\n_${list.length} saved talks · exported ${todayStr()}_\n`;
  const dayOrder = ["Workshop Day", "Session Day 1", "Session Day 2", "Session Day 3"];
  const byDay = new Map();
  list.forEach(t => { if (!byDay.has(t.dayLabel)) byDay.set(t.dayLabel, []); byDay.get(t.dayLabel).push(t); });
  [...byDay.keys()].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)).forEach(day => {
    md += `\n## ${day}\n\n`;
    byDay.get(day).forEach(t => {
      md += `- **${t.start || ""}${t.end ? "–" + t.end : ""}** · ${t.title}\n`;
      const sub = [t.loc, t.spk.join(", ")].filter(Boolean).join(" · ");
      if (sub) md += `  _${sub}_\n`;
    });
  });
  return md;
}
function toICS(list) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AIEWF2026 Explorer//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:AI Engineer World's Fair 2026",
    "BEGIN:VTIMEZONE", "TZID:America/Los_Angeles",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "TZNAME:PDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "TZNAME:PST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE"];
  list.forEach(t => {
    const dt = (s) => s ? s.replace(/[-:]/g, "").replace("T", "T") + "00" : null;
    const start = dt(t.startDT), end = dt(t.endDT) || start;
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + t.id + "@aiewf2026");
    lines.push("DTSTAMP:" + icsStamp());
    if (start) lines.push("DTSTART;TZID=America/Los_Angeles:" + start);
    if (end) lines.push("DTEND;TZID=America/Los_Angeles:" + end);
    lines.push("SUMMARY:" + icsEsc(t.title));
    const loc = [t.loc, "Moscone West, San Francisco"].filter(Boolean).join(", ");
    lines.push("LOCATION:" + icsEsc(loc));
    const desc = [t.spk.length ? "Speakers: " + t.spk.join(", ") : "", t.topic ? "Track: " + t.topic : "", t.abstract || ""].filter(Boolean).join("\\n\\n");
    if (desc) lines.push(foldLine("DESCRIPTION:" + icsEsc(desc)));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function foldLine(s) { if (s.length <= 74) return s; let out = "", i = 0; while (i < s.length) { out += (i ? "\r\n " : "") + s.slice(i, i + 73); i += 73; } return out; }
function icsStamp() { return "20260627T000000Z"; }

/* ============================================================
   DETAIL DRAWER
   ============================================================ */
function openDetail(id) {
  const t = TALKS.find(x => x.id === id);
  if (!t) return;
  const isFav = favs.has(id);
  const speakers = (t.speakers && t.speakers.length) ? t.speakers : t.spk.map(n => ({ n, r: "", o: "" }));
  const meta = (FACETS.days || []).find(d => d.label === t.dayLabel) || {};
  els.detailDrawer.innerHTML = `<div class="dd-scroll">
    <div class="dd-top">
      <div class="dd-badges">
        <span class="badge t-${t.type}">${typeLabel(t.type)}</span>
        ${t.tent ? `<span class="badge tentative">tentative</span>` : ""}
      </div>
      <button class="dd-close" data-close-detail aria-label="Close">×</button>
    </div>
    <h2 class="dd-title">${escapeHtml(t.title)}</h2>
    <div class="dd-meta">
      ${metaRow(`<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>`, t.dayLabel, fmtDate(t.date))}
      ${metaRow(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`, `${t.start || ""}${t.end ? " – " + t.end : ""}`, t.dur ? fmtDur(t.dur) + " long" : "")}
      ${t.loc ? metaRow(`<path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>`, t.loc, t.track && t.track !== t.loc ? t.track : "") : ""}
      ${t.topic ? metaRow(`<path d="M2 7l10-5 10 5-10 5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>`, t.topic, "track topic") : ""}
    </div>
    ${speakers.length ? `<div class="dd-section-title">Speaker${speakers.length > 1 ? "s" : ""}</div>
      ${speakers.map(s => `<div class="dd-speaker">
        <div class="dd-avatar" style="background:${avatarColor(s.n)}">${escapeHtml(initials(s.n))}</div>
        <div><div class="dd-sp-name">${escapeHtml(s.n)}</div>${(s.r || s.o) ? `<div class="dd-sp-role">${escapeHtml([s.r, s.o].filter(Boolean).join(", "))}</div>` : ""}</div>
      </div>`).join("")}` : ""}
    ${t.abstract ? `<div class="dd-section-title">About this talk</div><p class="dd-abstract">${escapeHtml(t.abstract)}</p>` : `<div class="dd-section-title">About</div><p class="dd-abstract" style="opacity:.6">No abstract provided for this session.</p>`}
    ${(t.tags && t.tags.length) ? `<div class="dd-section-title">Tags</div><div class="dd-tags">${t.tags.map(tg => `<span class="tagchip" data-tag-jump="${escapeHtml(tg)}" style="cursor:pointer">${escapeHtml(tagLabel(tg))}</span>`).join("")}</div>` : ""}
    <div class="dd-actions">
      <button class="dd-fav${isFav ? " on" : ""}" data-fav="${t.id}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        <span>${isFav ? "Saved to My Events" : "Add to My Events"}</span>
      </button>
    </div>
  </div>`;
  els.detailDrawer.querySelector("[data-close-detail]").addEventListener("click", closeDetail);
  els.detailDrawer.querySelector(".dd-fav").addEventListener("click", () => toggleFav(t.id));
  els.detailDrawer.querySelectorAll("[data-tag-jump]").forEach(b => b.addEventListener("click", () => {
    closeDetail(); state.tags.clear(); state.tags.add(b.dataset.tagJump); state.interpretation = null; syncFilterUI(); render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  showDrawer(els.detailDrawer, els.detailScrim);
}
function metaRow(svg, val, k) {
  return `<div class="dd-meta-row"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>
    <div><span class="v">${escapeHtml(val)}</span>${k ? ` <span class="k">· ${escapeHtml(k)}</span>` : ""}</div></div>`;
}
function closeDetail() { hideDrawer(els.detailDrawer, els.detailScrim); }

/* ============================================================
   MY EVENTS open/close
   ============================================================ */
function openMyEvents() { renderMyEvents(); showDrawer(els.myEventsDrawer, els.myEventsScrim); }
function closeMyEvents() { hideDrawer(els.myEventsDrawer, els.myEventsScrim); }

function showDrawer(drawer, scrim) {
  scrim.hidden = false; drawer.hidden = false; drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function hideDrawer(drawer, scrim) {
  scrim.hidden = true; drawer.hidden = true; drawer.setAttribute("aria-hidden", "true");
  if (els.detailDrawer.hidden && els.myEventsDrawer.hidden) document.body.style.overflow = "";
}

/* ============================================================
   VIEW + THEME
   ============================================================ */
function setView(v, save = true) {
  state.view = v;
  els.viewSwitch.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  if (save) store.set(LS.view, v);
}
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  store.set(LS.theme, t);
}

/* ============================================================
   SETTINGS
   ============================================================ */
function openSettings() {
  els.apikeyInput.value = store.get(LS.apikey, "");
  els.useLLMToggle.checked = !!store.get(LS.useLLM, false);
  els.settingsStatus.textContent = "";
  els.settingsScrim.hidden = false;
}
function closeSettings() { els.settingsScrim.hidden = true; }
function saveSettings() {
  const key = els.apikeyInput.value.trim();
  store.set(LS.apikey, key);
  store.set(LS.useLLM, els.useLLMToggle.checked && !!key);
  els.settingsStatus.textContent = key ? "Saved ✓ Claude enabled" : "Saved ✓ using on-device parser";
  setTimeout(closeSettings, 900);
}

/* ============================================================
   ASK BAR
   ============================================================ */
async function runAsk() {
  const q = els.askInput.value.trim();
  if (!q) { applySpec({ search: "", note: "" }, "clear"); return; }
  const useLLM = store.get(LS.useLLM, false) && store.get(LS.apikey, "");
  els.askGo.classList.add("loading");
  try {
    let spec;
    if (useLLM) {
      try { spec = await llmParse(q); spec._source = "llm"; }
      catch (e) { spec = localParse(q); spec._source = "local"; toast("Claude unavailable — used on-device parser"); }
    } else {
      spec = localParse(q);
      spec._source = "local";
    }
    applySpec(spec, spec._source);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    els.askGo.classList.remove("loading");
  }
}
const SUGGESTIONS = [
  "voice agents on day 2 in the afternoon",
  "keynotes about agents",
  "evals and observability workshops",
  "RAG and retrieval talks",
  "short lightning talks on security",
  "everything about robotics & world models",
  "AI in healthcare on the main stage",
];
function renderSuggestions() {
  els.askSuggest.innerHTML = SUGGESTIONS.map(s => `<button class="suggest-chip" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("");
  els.askSuggest.querySelectorAll("[data-suggest]").forEach(b => b.addEventListener("click", () => {
    els.askInput.value = b.dataset.suggest; els.askClear.hidden = false; runAsk();
  }));
}

/* ============================================================
   RESET
   ============================================================ */
function resetAll() {
  state.search = ""; state.speaker = "";
  ["days", "types", "topics", "locations", "tags", "times", "durations"].forEach(k => state[k].clear());
  state.favOnly = state.hasAbstract = state.hideTentative = false;
  state.interpretation = null;
  els.askInput.value = ""; els.askClear.hidden = true;
  state.sort = "time"; els.sort.value = "time";
  syncFilterUI(); render();
}

/* ============================================================
   UTIL
   ============================================================ */
function typeLabel(t) {
  return ({ KEYNOTE: "Keynote", SESSION: "Session", WORKSHOP: "Workshop", SPONSOR: "Sponsor", SPECIAL_EVENT: "Special" })[t] || t;
}
const TAG_LABEL_MAP = {};
(FACETS.tags || []).forEach(t => TAG_LABEL_MAP[t.key] = t.label);
function tagLabel(k) { return TAG_LABEL_MAP[k] || k.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function cssEsc(s) { return String(s).replace(/"/g, '\\"'); }
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, m - 1, d).getDay()];
  return `${wd}, ${months[m - 1]} ${d}`;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function initials(n) { return (n || "?").split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toUpperCase(); }
function avatarColor(n) {
  const colors = ["#5b54e6", "#c2740b", "#2f7d4f", "#7c4ddb", "#0f8a8a", "#c0392b", "#2563eb", "#b45309"];
  let h = 0; for (const ch of (n || "")) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return colors[h % colors.length];
}
function debounce(fn, ms) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }
function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove(); }
let toastTimer;
function toast(msg) {
  els.toast.textContent = msg; els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.classList.remove("show"); setTimeout(() => els.toast.hidden = true, 250); }, 2200);
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  // header meta
  $("conf-name").textContent = CONF.name || "AI Engineer World's Fair 2026";
  $("conf-meta").textContent = [CONF.dateRange, CONF.location].filter(Boolean).join("  ·  ");
  $("footer-text").textContent = `${CONF.count || TALKS.length} talks · ${CONF.dateRange || ""} · ${CONF.location || ""}`;
  const fl = $("footer-link"); if (CONF.link) fl.href = CONF.link; else fl.hidden = true;

  // theme
  const savedTheme = store.get(LS.theme, null);
  setTheme(savedTheme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  // view
  setView(state.view, false);
  els.sort.value = state.sort;

  buildFilters();
  renderSuggestions();
  renderFavCount();
  render();

  // ---- events ----
  els.askGo.addEventListener("click", runAsk);
  els.askInput.addEventListener("keydown", e => { if (e.key === "Enter") runAsk(); });
  els.askInput.addEventListener("input", () => { els.askClear.hidden = !els.askInput.value; });
  els.askClear.addEventListener("click", () => { els.askInput.value = ""; els.askClear.hidden = true; applySpec({ search: "", note: "" }, "clear"); els.askInput.focus(); });

  els.sort.addEventListener("change", () => { state.sort = els.sort.value; render(); });
  els.viewSwitch.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { setView(b.dataset.view); render(); }));

  $("btn-theme").addEventListener("click", () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
  $("btn-myevents").addEventListener("click", openMyEvents);
  $("btn-settings").addEventListener("click", openSettings);
  $("clear-all").addEventListener("click", resetAll);
  $("empty-reset").addEventListener("click", resetAll);

  // my events drawer
  els.myEventsScrim.addEventListener("click", closeMyEvents);
  document.querySelectorAll("[data-close-myevents]").forEach(b => b.addEventListener("click", closeMyEvents));
  document.querySelectorAll("[data-export]").forEach(b => b.addEventListener("click", () => exportMyEvents(b.dataset.export)));

  // detail drawer
  els.detailScrim.addEventListener("click", closeDetail);

  // settings
  els.settingsScrim.addEventListener("click", e => { if (e.target === els.settingsScrim) closeSettings(); });
  document.querySelectorAll("[data-close-settings]").forEach(b => b.addEventListener("click", closeSettings));
  $("save-settings").addEventListener("click", saveSettings);

  // mobile filters
  $("btn-filters-mobile").addEventListener("click", () => { els.sidebar.classList.add("open"); els.sidebarScrim.hidden = false; });
  $("close-sidebar").addEventListener("click", closeMobileFilters);
  els.sidebarScrim.addEventListener("click", closeMobileFilters);

  // keyboard
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!els.settingsScrim.hidden) closeSettings();
      else if (!els.detailDrawer.hidden) closeDetail();
      else if (!els.myEventsDrawer.hidden) closeMyEvents();
      else if (els.sidebar.classList.contains("open")) closeMobileFilters();
    }
    if (e.key === "/" && document.activeElement !== els.askInput && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); els.askInput.focus();
    }
  });
}
function closeMobileFilters() { els.sidebar.classList.remove("open"); els.sidebarScrim.hidden = true; }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
