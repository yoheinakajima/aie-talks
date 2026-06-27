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
const ENRICH = window.AIEWF_ENRICH || {};   // { id: {keyphrases[], entities[], summary} }
const LS = {
  favs: "aiewf:favs", theme: "aiewf:theme", view: "aiewf:view",
  apikey: "aiewf:apikey", useLLM: "aiewf:useLLM", semantic: "aiewf:semantic",
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
  semQuery: "",            // raw natural-language query for semantic ranking
  days: new Set(), types: new Set(), topics: new Set(),
  locations: new Set(), tags: new Set(), orgs: new Set(),
  times: new Set(), durations: new Set(),
  speaker: "",
  favOnly: false, hasAbstract: false, hideTentative: false,
  pinned: null,            // Set of ids when "filter to map selection" is active
  sort: "time",
  view: ["agenda","list","compact","map"].includes(store.get(LS.view, "agenda")) ? store.get(LS.view, "agenda") : "agenda",
  interpretation: null,
};

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  askInput: $("ask-input"), askGo: $("ask-go"), askClear: $("ask-clear"),
  askSuggest: $("ask-suggest"), askSem: $("ask-sem"), askExamplesToggle: $("ask-examples-toggle"),
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
  useLLMToggle: $("use-llm-toggle"), useSemanticToggle: $("use-semantic-toggle"),
  settingsStatus: $("settings-status"),
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
// pre-build a lightweight search blob per talk (now enriched with LLM keyphrases)
TALKS.forEach(t => {
  const en = ENRICH[t.id] || {};
  t._kp = en.keyphrases || [];
  t._ent = en.entities || [];
  t._summary = en.summary || "";
  t._kp_l = t._kp.join(" ").toLowerCase();
  t._ent_l = t._ent.join(" ").toLowerCase();
  t._blob = [
    t.title, t.title, // weight title
    t.spk.join(" "),
    (t.speakers || []).map(s => s.o).join(" "),
    t.topic || "", (t.tags || []).map(x => x.replace(/-/g, " ")).join(" "),
    t._kp.join(" "), t._ent.join(" "), t._summary,
    t.abstract,
  ].join(" \n ").toLowerCase();
  t._title_l = (t.title || "").toLowerCase();
});
function scoreTalk(talk, terms) {
  if (!terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    if (talk._title_l.includes(term)) score += 8;
    if (talk._kp_l.includes(term)) score += 6;          // specific LLM keyphrases
    if (talk._ent_l.includes(term)) score += 6;          // named products/orgs/models
    if ((talk.tags || []).some(tg => tg.includes(term))) score += 5;
    if ((talk.topic || "").toLowerCase().includes(term)) score += 4;
    if (talk.spk.join(" ").toLowerCase().includes(term)) score += 5;
    if (talk._summary && talk._summary.toLowerCase().includes(term)) score += 3;
    if (talk.abstract && talk.abstract.toLowerCase().includes(term)) score += 1.5;
  }
  return score;
}

/* ============================================================
   SEMANTIC SEARCH  (in-browser embeddings, fully optional)
   Corpus vectors come from data/vectors.js (lazy). Query vectors
   are computed by Transformers.js using the SAME model the corpus
   was built with (Xenova/all-MiniLM-L6-v2), so they share one space.
   ============================================================ */
const SEM = {
  enabled: store.get(LS.semantic, true) !== false, // default on
  status: "idle",        // idle | loading | ready | error | off
  query: null,           // text the current scores were computed for
  byId: null,            // Map<id, cosine> for the current query
  vec: null,             // window.AIEWF_VEC artifact
  rows: null,            // Float32Array matrix (count x dim), L2-normalized
  _vecP: null, _modelP: null,
};
const SEM_INCLUDE = 0.32;   // min cosine to surface a semantic-only (no keyword) match
const SEM_MAX_ONLY = 60;    // cap on semantic-only additions per query
const RRF_K = 60;

// lazy-load the vector artifact (data/vectors.js)
function ensureVec() {
  if (window.AIEWF_VEC) return Promise.resolve(window.AIEWF_VEC);
  if (SEM._vecP) return SEM._vecP;
  SEM._vecP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "data/vectors.js";
    s.onload = () => res(window.AIEWF_VEC);
    s.onerror = () => rej(new Error("vectors.js failed to load"));
    document.head.appendChild(s);
  });
  return SEM._vecP;
}
// decode int8 base64 -> normalized Float32 rows (once)
function decodeVec() {
  if (SEM.rows) return;
  const v = window.AIEWF_VEC; SEM.vec = v;
  const dim = v.dim, n = v.count, scale = v.scale;
  const bin = atob(v.vectorsB64);
  const rows = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    let nrm = 0;
    for (let d = 0; d < dim; d++) {
      let b = bin.charCodeAt(i * dim + d);
      if (b > 127) b -= 256;             // signed byte
      const f = b / scale; rows[i * dim + d] = f; nrm += f * f;
    }
    nrm = Math.sqrt(nrm) || 1;            // renormalize after quantization
    for (let d = 0; d < dim; d++) rows[i * dim + d] /= nrm;
  }
  SEM.rows = rows;
  SEM.idIndex = new Map(v.ids.map((id, i) => [id, i]));
}
// load the embedding model from CDN (Transformers.js), cached by the browser
function ensureModel() {
  if (SEM._modelP) return SEM._modelP;
  SEM._modelP = (async () => {
    const mod = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;
    return await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
  })();
  return SEM._modelP;
}
async function embedQuery(text) {
  const extractor = await ensureModel();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data);
}
function cosineAll(qv) {
  const { rows, vec } = SEM; const dim = vec.dim, n = vec.count;
  const sims = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; const o = i * dim;
    for (let d = 0; d < dim; d++) s += qv[d] * rows[o + d];
    sims[i] = s;
  }
  return sims;
}
// compute (or clear) semantic scores for a query, then re-render
async function runSemantic(text) {
  text = (text || "").trim();
  SEM.query = text;
  if (!text || !SEM.enabled) {
    SEM.byId = null; SEM.status = SEM.enabled ? "idle" : "off"; updateSemIndicator(); return;
  }
  SEM.status = "loading"; updateSemIndicator();
  try {
    await ensureVec(); decodeVec();
    const qv = await embedQuery(text);
    if (SEM.query !== text) return;          // superseded by a newer query
    const sims = cosineAll(qv);
    const m = new Map();
    SEM.vec.ids.forEach((id, i) => m.set(id, sims[i]));
    SEM.byId = m; SEM.status = "ready"; updateSemIndicator();
    render();                                 // upgrade results with semantic signal
  } catch (e) {
    SEM.status = "error"; SEM.byId = null; updateSemIndicator();
  }
}
function semScoresCurrent() {
  return SEM.enabled && SEM.byId && SEM.query && SEM.query === (state.semQuery || "").trim() ? SEM.byId : null;
}
function neighborsFor(id) {                    // for "Related talks"; needs vectors loaded
  const v = window.AIEWF_VEC; if (!v) return null;
  const i = v.ids.indexOf(id); if (i < 0) return null;
  return (v.neighbors[i] || []);
}
function clusterLabelFor(id) {
  const v = window.AIEWF_VEC; if (!v) return null;
  const i = v.ids.indexOf(id); if (i < 0) return null;
  return v.clusterLabels[v.cluster[i]] || null;
}
function updateSemIndicator() {
  const el = els.askSem; if (!el) return;
  if (!SEM.enabled || !(state.semQuery || "").trim()) { el.hidden = true; return; }
  el.hidden = false;
  const map = {
    loading: ["sem-loading", "◐", "Loading semantic model…"],
    ready: ["sem-ready", "✦", "Semantic search on"],
    error: ["sem-error", "!", "Semantic offline — using keywords"],
    idle: ["sem-idle", "✦", "Semantic ready"],
  };
  const [cls, glyph, title] = map[SEM.status] || map.idle;
  el.className = "ask-sem " + cls;
  el.textContent = glyph;
  el.title = title;
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
  if (/\bcompact|dense|table\b/.test(q)) spec.view = "compact";
  if (/\bagenda|by day|timeline\b/.test(q)) spec.view = "agenda";
  // favorites
  if (/my favorite|favourited|favorited|my events|saved|my schedule/.test(q)) spec.favOnly = true;

  // topic exact-ish match — only for specific multi-word track names, so a
  // broad single word ("security", "evals", "inference") doesn't hard-narrow
  // to a tiny track; tags + semantic ranking handle those instead.
  TOPIC_KEYS.forEach(tk => { if (tk.includes(" ") && q.includes(tk.toLowerCase())) spec.topics.push(tk); });

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
 "view": string,             // one of: "agenda","list","compact" or ""
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
    view: ["agenda","list","compact"].includes(s.view) ? s.view : null,
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
  // semantic ranking uses the full raw request when available
  state.semQuery = (spec._raw != null ? spec._raw : (spec.search || "")).trim();
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
  runSemantic(state.semQuery);   // async; re-renders when ready
}

/* ============================================================
   FILTERING + SORTING
   ============================================================ */
function activeFilterTotal() {
  return state.days.size + state.types.size + state.topics.size + state.locations.size +
    state.tags.size + state.orgs.size + state.times.size + state.durations.size +
    (state.speaker ? 1 : 0) + (state.favOnly ? 1 : 0) +
    (state.hasAbstract ? 1 : 0) + (state.hideTentative ? 1 : 0);
}
// returns talks passing all hard (non-text) filters
function hardFilter(t) {
  if (state.pinned && !state.pinned.has(t.id)) return false;
  if (state.days.size && !state.days.has(t.dayLabel)) return false;
  if (state.types.size && !state.types.has(t.type)) return false;
  if (state.topics.size && !state.topics.has(t.topic)) return false;
  if (state.locations.size && !state.locations.has(t.loc)) return false;
  if (state.orgs.size && !(t.speakers || []).some(s => s.o && state.orgs.has(s.o))) return false;
  if (state.tags.size && !(t.tags || []).some(tg => state.tags.has(tg))) return false;
  if (state.times.size && !state.times.has(timeBucket(t.start))) return false;
  if (state.durations.size && !state.durations.has(durBucket(t.dur))) return false;
  if (state.favOnly && !favs.has(t.id)) return false;
  if (state.hasAbstract && !t.abstract) return false;
  if (state.hideTentative && t.tent) return false;
  const spkQ = state.speaker.toLowerCase().trim();
  if (spkQ) {
    const hay = (t.spk.join(" ") + " " + (t.speakers || []).map(s => s.o).join(" ")).toLowerCase();
    if (!hay.includes(spkQ)) return false;
  }
  return true;
}
function filterTalks() {
  const terms = tokenize(state.search);
  const sem = semScoresCurrent();
  // Free-text relevance intent — only true when the query carries actual search
  // words. A purely structural request (speaker / tag / day / type filter with no
  // free text, e.g. searching a person's name that the parser routed to `speaker`)
  // must return EVERY talk that passes the hard filters. Semantic similarity may
  // reorder those talks, but it must never exclude them: a name like "Yohei" has
  // no semantic signal, so gating on the cosine threshold would drop the very
  // talk the user filtered to.
  const hasText = terms.length > 0;
  const cands = [];
  for (const t of TALKS) {
    if (!hardFilter(t)) continue;
    const lex = hasText ? scoreTalk(t, terms) : 0;
    const ss = sem ? (sem.get(t.id) ?? 0) : null;
    cands.push({ t, lex, ss, score: 0, _sem: ss, _semOnly: false });
  }
  if (!hasText) { sortResults(cands, false); return cands; }

  // Reciprocal Rank Fusion of the lexical and semantic orderings
  const lexRanked = cands.filter(c => c.lex > 0).sort((a, b) => b.lex - a.lex);
  const lexRank = new Map(lexRanked.map((c, i) => [c, i]));
  let semRank = null, semOnly = null;
  if (sem) {
    const semRanked = [...cands].sort((a, b) => b.ss - a.ss);
    semRank = new Map(semRanked.map((c, i) => [c, i]));
    semOnly = new Set(cands.filter(c => c.ss >= SEM_INCLUDE)
      .sort((a, b) => b.ss - a.ss).slice(0, SEM_MAX_ONLY));
  }
  const out = [];
  for (const c of cands) {
    const incLex = c.lex > 0;
    const incSem = sem && semOnly.has(c);
    if (!incLex && !incSem) continue;
    let rrf = 0;
    if (incLex) rrf += 1 / (RRF_K + lexRank.get(c));
    if (sem) rrf += 1 / (RRF_K + semRank.get(c));
    c.score = rrf * 1000;
    c._semOnly = !incLex && incSem;
    out.push(c);
  }
  sortResults(out, true);
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
let LAST_SEMONLY = new Set();
function render() {
  const results = filterTalks();
  LAST_SEMONLY = new Set(results.filter(r => r._semOnly).map(r => r.t.id));
  renderResultCount(results.length);
  renderChips();
  renderInterpretation();
  renderFavCount();
  updateFilterCheckStates();

  const terms = tokenize(state.search);
  const mapEl = $("map-wrap");

  if (state.view === "map") {
    els.results.innerHTML = ""; els.results.className = "results";
    els.empty.hidden = true; mapEl.hidden = false;
    renderMap(results);
    return;
  }
  if (mapEl) mapEl.hidden = true;

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
    (LAST_SEMONLY.has(t.id) ? `<span class="badge sem" title="related by meaning">✦ related</span>` : "") +
    (t.topic ? `<span class="topic-pill">${escapeHtml(t.topic)}</span>` : "") +
    (t.tent ? `<span class="badge tentative">tentative</span>` : "");
  const room = t.loc ? `<span class="room-pill">${escapeHtml(t.loc)}</span>` : "";
  const preview = t.abstract
    ? `<p class="card-abstract">${highlight(t.abstract.slice(0, 320), terms)}</p>`
    : (t._summary ? `<p class="card-abstract card-summary">${highlight(t._summary, terms)}</p>` : "");
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
      ${preview}
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
  const extra = LAST_SEMONLY.size ? ` · <span class="rc-sem" title="surfaced by semantic similarity, not keyword match">+${LAST_SEMONLY.size} by meaning</span>` : "";
  els.resultCount.innerHTML = `<b>${n}</b> of ${TALKS.length} talks${extra}`;
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
  state.orgs.forEach(o => add("org", o, () => state.orgs.delete(o)));
  state.times.forEach(t => add("time", t, () => state.times.delete(t)));
  state.durations.forEach(d => add("length", DUR_BUCKETS.find(x => x.key === d)?.label || d, () => state.durations.delete(d)));
  if (state.speaker) add("speaker", state.speaker, () => state.speaker = "");
  if (state.search) add("search", "“" + state.search + "”", () => state.search = "");
  if (state.pinned) add("map", `selection · ${state.pinned.size}`, () => state.pinned = null);
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
  const orgCounts = {};
  TALKS.forEach(t => (t.speakers || []).forEach(s => { if (s.o) orgCounts[s.o] = (orgCounts[s.o] || 0) + 1; }));
  const orgs = Object.entries(orgCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, c]) => ({ key: k, label: k, count: c }));

  const panels = [
    panel("Day", "days", optsHTML("days", days)),
    panel("Type", "types", optsHTML("types", types)),
    panel("Time of day", "times", optsHTML("times", TIME_BUCKETS.map(b => ({ key: b.key, label: b.label, count: countBy(t => timeBucket(t.start) === b.key), sub: b.hint })))),
    panel("Length", "durations", optsHTML("durations", DUR_BUCKETS.map(b => ({ key: b.key, label: b.label, count: countBy(t => durBucket(t.dur) === b.key), sub: b.hint })))),
    panel("Track topic", "topics", `<div class="opt-scroll">${optsHTML("topics", topics)}</div>`),
    panel("Room / stage", "locations", `<div class="opt-scroll">${optsHTML("locations", locations)}</div>`, true),
    panel("Tags", "tags",
      `<input class="tag-search" id="tag-search" placeholder="Filter tags…" /><div class="opt-scroll" id="tag-opts">${optsHTML("tags", tags)}</div>`),
    panel("Organization", "orgs",
      `<input class="tag-search" id="org-search" placeholder="Filter organizations…" /><div class="opt-scroll" id="org-opts">${optsHTML("orgs", orgs)}</div>`, true),
    panel("Speaker / org search", "speaker", `<input class="tag-search" id="speaker-search" placeholder="e.g. OpenAI, Simon…" value="${escapeHtml(state.speaker)}" />`),
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
  const filterOptList = (input, container) => {
    if (!input) return;
    input.addEventListener("input", () => {
      const q = input.value.toLowerCase();
      $(container).querySelectorAll(".opt").forEach(o => {
        o.style.display = o.querySelector(".lbl").textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
  };
  filterOptList($("tag-search"), "tag-opts");
  filterOptList($("org-search"), "org-opts");
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
        <span class="badge cluster" id="dd-cluster" hidden></span>
      </div>
      <button class="dd-close" data-close-detail aria-label="Close">×</button>
    </div>
    <h2 class="dd-title">${escapeHtml(t.title)}</h2>
    ${t._summary ? `<p class="dd-summary">${escapeHtml(t._summary)}</p>` : ""}
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
    ${(t._kp && t._kp.length) ? `<div class="dd-section-title">Key topics</div><div class="dd-tags">${t._kp.slice(0, 10).map(kp => `<span class="kpchip" data-kp-search="${escapeHtml(kp)}" title="Search “${escapeHtml(kp)}”">${escapeHtml(kp)}</span>`).join("")}</div>` : ""}
    ${(t.tags && t.tags.length) ? `<div class="dd-section-title">Tags</div><div class="dd-tags">${t.tags.map(tg => `<span class="tagchip" data-tag-jump="${escapeHtml(tg)}" style="cursor:pointer">${escapeHtml(tagLabel(tg))}</span>`).join("")}</div>` : ""}
    <div class="dd-section-title">Related talks</div>
    <div class="dd-related" id="dd-related"><div class="dd-related-load">Finding similar talks…</div></div>
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
  els.detailDrawer.querySelectorAll("[data-kp-search]").forEach(b => b.addEventListener("click", () => {
    closeDetail(); els.askInput.value = b.dataset.kpSearch; els.askClear.hidden = false; runAsk();
  }));
  populateRelated(id);
  showDrawer(els.detailDrawer, els.detailScrim);
}
// fill the Related-talks strip from precomputed neighbors (lazy-loads vectors.js)
function populateRelated(id) {
  const host = els.detailDrawer.querySelector("#dd-related");
  if (!host) return;
  ensureVec().then(() => {
    if (els.detailDrawer.hidden) return;
    // guard: drawer might have switched to another talk
    const stillOpen = els.detailDrawer.querySelector(".dd-fav");
    if (!stillOpen || stillOpen.dataset.fav !== id) return;
    const cl = clusterLabelFor(id);
    const clEl = els.detailDrawer.querySelector("#dd-cluster");
    if (cl && clEl) { clEl.hidden = false; clEl.textContent = cl; }
    const nb = neighborsFor(id);
    if (!nb || !nb.length) { host.innerHTML = `<div class="dd-related-load">No similar talks found.</div>`; return; }
    host.innerHTML = nb.slice(0, 6).map(n => {
      const rt = TALKS.find(x => x.id === n.id); if (!rt) return "";
      const sim = Math.round(n.s * 100);
      const who = rt.spk && rt.spk.length ? escapeHtml(rt.spk[0]) + (rt.spk.length > 1 ? " +" + (rt.spk.length - 1) : "") : "";
      return `<button class="dd-rel" data-rel="${rt.id}">
        <span class="dd-rel-sim" title="${sim}% similar">${sim}%</span>
        <span class="dd-rel-info"><span class="dd-rel-title">${escapeHtml(rt.title)}</span>
        <span class="dd-rel-sub">${escapeHtml(shortDay(rt.dayLabel))}${rt.start ? " · " + escapeHtml(rt.start) : ""}${who ? " · " + who : ""}</span></span>
      </button>`;
    }).join("");
    host.querySelectorAll("[data-rel]").forEach(b => b.addEventListener("click", () => openDetail(b.dataset.rel)));
  }).catch(() => { host.innerHTML = `<div class="dd-related-load">Similar talks unavailable offline.</div>`; });
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
  if (els.useSemanticToggle) els.useSemanticToggle.checked = SEM.enabled;
  els.settingsStatus.textContent = "";
  els.settingsScrim.hidden = false;
}
function closeSettings() { els.settingsScrim.hidden = true; }
function saveSettings() {
  const key = els.apikeyInput.value.trim();
  store.set(LS.apikey, key);
  store.set(LS.useLLM, els.useLLMToggle.checked && !!key);
  const semOn = els.useSemanticToggle ? els.useSemanticToggle.checked : SEM.enabled;
  if (semOn !== SEM.enabled) {
    SEM.enabled = semOn; store.set(LS.semantic, semOn);
    if (semOn) runSemantic(state.semQuery);
    else { SEM.byId = null; SEM.status = "off"; updateSemIndicator(); render(); }
  }
  els.settingsStatus.textContent = "Saved ✓" + (key ? " · Claude enabled" : "") + (semOn ? " · semantic on" : "");
  setTimeout(closeSettings, 900);
}

/* ============================================================
   ASK BAR
   ============================================================ */
async function runAsk() {
  const q = els.askInput.value.trim();
  if (q) toggleSearchBar(true);
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
    spec._raw = q;            // full text drives semantic ranking
    applySpec(spec, spec._source);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    els.askGo.classList.remove("loading");
  }
}
const SUGGESTIONS = [
  "event sourcing",
  "keeping humans in the loop",
  "making models run cheaper and faster",
  "voice agents on day 2 in the afternoon",
  "evals and observability workshops",
  "RAG and retrieval talks",
  "short lightning talks on security",
  "stop my agent from hallucinating",
];
function renderSuggestions() {
  els.askSuggest.innerHTML = SUGGESTIONS.map(s => `<button class="suggest-chip" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("");
  els.askSuggest.querySelectorAll("[data-suggest]").forEach(b => b.addEventListener("click", () => {
    els.askInput.value = b.dataset.suggest; els.askClear.hidden = false; runAsk();
  }));
}
function setExamplesShown(show) {
  els.askSuggest.hidden = !show;
  els.askExamplesToggle.textContent = show ? "Hide examples" : "Show examples";
}
function toggleSearchBar(force) {
  const wrap = $("ask-wrap");
  const btn = $("btn-search");
  const show = force === undefined ? wrap.hidden : force;
  wrap.hidden = !show;
  btn.classList.toggle("active", show);
  btn.setAttribute("aria-expanded", show ? "true" : "false");
  if (show) els.askInput.focus();
}

/* ============================================================
   RESET
   ============================================================ */
function resetAll() {
  state.search = ""; state.speaker = ""; state.semQuery = "";
  ["days", "types", "topics", "locations", "tags", "orgs", "times", "durations"].forEach(k => state[k].clear());
  state.favOnly = state.hasAbstract = state.hideTentative = false;
  state.pinned = null;
  state.interpretation = null;
  els.askInput.value = ""; els.askClear.hidden = true;
  state.sort = "time"; els.sort.value = "time";
  runSemantic("");
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
  const colors = ["#1e2d3e", "#c0830c", "#2c8c58", "#b0408c", "#3667cf", "#d75f3c", "#56616f", "#0f8a8a"];
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
   VECTOR MAP  (canvas scatter of UMAP coords + clusters)
   ============================================================ */
const TYPE_COLORS = { KEYNOTE: "#c0830c", SESSION: "#3667cf", WORKSHOP: "#2c8c58", SPONSOR: "#56616f", SPECIAL_EVENT: "#b0408c" };
const DAY_COLORS = { "Workshop Day": "#f5a623", "Session Day 1": "#5b8def", "Session Day 2": "#37b679", "Session Day 3": "#e0457b" };
const MAP = {
  ready: false, wired: false, canvas: null, ctx: null,
  w: 0, h: 0, dpr: 1,
  pts: [], clusterColors: [], centroids: [],
  tf: { x: 0, y: 0, scale: 1 },
  colorMode: "cluster", muted: new Set(),
  lasso: false, lassoPath: [], dragging: false, panning: false, last: null, moved: false,
  selected: new Set(), hover: null, matched: null,
};
function clusterPalette(k) {
  return Array.from({ length: k }, (_, i) => `hsl(${Math.round((360 * i / k + i * 47) % 360)}, 62%, 55%)`);
}
function renderMap(results) {
  MAP.matched = new Set(results.map(r => r.t.id));
  const loading = $("map-loading");
  if (!window.AIEWF_VEC) {
    if (loading) loading.hidden = false;
    ensureVec().then(() => { buildMap(); if (loading) loading.hidden = true; drawMap(); })
      .catch(() => { if (loading) loading.textContent = "Vector map unavailable offline."; });
    return;
  }
  if (loading) loading.hidden = true;
  buildMap();
  drawMap();
}
function buildMap() {
  if (MAP.ready) { sizeCanvas(); return; }
  const v = window.AIEWF_VEC;
  MAP.clusterColors = clusterPalette(v.clusterK);
  MAP.pts = v.ids.map((id, i) => {
    const t = TALKS.find(x => x.id === id);
    return { id, i, t, wx: v.coords[i][0], wy: v.coords[i][1], cluster: v.cluster[i] };
  }).filter(p => p.t);
  // cluster centroids (world coords) for labels
  const acc = {};
  MAP.pts.forEach(p => { (acc[p.cluster] = acc[p.cluster] || { x: 0, y: 0, n: 0 }); acc[p.cluster].x += p.wx; acc[p.cluster].y += p.wy; acc[p.cluster].n++; });
  MAP.centroids = Object.entries(acc).map(([c, a]) => ({ cluster: +c, x: a.x / a.n, y: a.y / a.n, n: a.n, label: v.clusterLabels[+c] || "" }));
  MAP.canvas = $("map-canvas"); MAP.ctx = MAP.canvas.getContext("2d");
  sizeCanvas();
  if (!MAP.wired) wireMap();
  buildMapLegend();
  fitView();
  MAP.ready = true;
}
function sizeCanvas() {
  const stage = MAP.canvas.parentElement;
  const r = stage.getBoundingClientRect();
  MAP.w = Math.max(320, r.width); MAP.h = Math.max(320, r.height);
  MAP.dpr = window.devicePixelRatio || 1;
  MAP.canvas.width = MAP.w * MAP.dpr; MAP.canvas.height = MAP.h * MAP.dpr;
  MAP.canvas.style.width = MAP.w + "px"; MAP.canvas.style.height = MAP.h + "px";
  MAP.ctx.setTransform(MAP.dpr, 0, 0, MAP.dpr, 0, 0);
}
function fitView() { MAP.tf = { x: 0, y: 0, scale: 1 }; }
function worldToScreen(wx, wy) {
  const base = Math.min(MAP.w, MAP.h) / 2 * 0.92;
  return [MAP.w / 2 + wx * base * MAP.tf.scale + MAP.tf.x, MAP.h / 2 - wy * base * MAP.tf.scale + MAP.tf.y];
}
function pointCategory(p) {
  if (MAP.colorMode === "type") return p.t.type;
  if (MAP.colorMode === "day") return p.t.dayLabel;
  return p.cluster;
}
function pointColor(p) {
  if (MAP.colorMode === "type") return TYPE_COLORS[p.t.type] || "#888";
  if (MAP.colorMode === "day") return DAY_COLORS[p.t.dayLabel] || "#888";
  return MAP.clusterColors[p.cluster] || "#888";
}
function isActive(p) {
  if (MAP.matched && !MAP.matched.has(p.id)) return false;
  if (MAP.muted.has(String(pointCategory(p)))) return false;
  return true;
}
function drawMap() {
  if (!MAP.ready) return;
  const ctx = MAP.ctx; const dark = document.documentElement.getAttribute("data-theme") === "dark";
  ctx.clearRect(0, 0, MAP.w, MAP.h);
  const r = Math.max(2.2, 3.2 * Math.sqrt(MAP.tf.scale));
  // faded (inactive) first
  for (const p of MAP.pts) {
    if (isActive(p)) continue;
    const [sx, sy] = worldToScreen(p.wx, p.wy);
    if (sx < -20 || sx > MAP.w + 20 || sy < -20 || sy > MAP.h + 20) continue;
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.8, 0, 6.2832);
    ctx.fillStyle = dark ? "rgba(120,130,150,.16)" : "rgba(120,130,150,.18)"; ctx.fill();
  }
  // active points
  for (const p of MAP.pts) {
    if (!isActive(p)) continue;
    const [sx, sy] = worldToScreen(p.wx, p.wy);
    if (sx < -20 || sx > MAP.w + 20 || sy < -20 || sy > MAP.h + 20) continue;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832);
    ctx.fillStyle = pointColor(p); ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
    if (MAP.selected.has(p.id)) { ctx.lineWidth = 2; ctx.strokeStyle = dark ? "#fff" : "#111"; ctx.stroke(); }
    if (favs.has(p.id)) { ctx.lineWidth = 2; ctx.strokeStyle = "#f5a623"; ctx.stroke(); }
  }
  // neighbor links on hover
  if (MAP.hover) {
    const nb = neighborsFor(MAP.hover.id) || [];
    const [hx, hy] = worldToScreen(MAP.hover.wx, MAP.hover.wy);
    ctx.strokeStyle = dark ? "rgba(180,200,255,.5)" : "rgba(60,90,200,.45)"; ctx.lineWidth = 1.2;
    nb.slice(0, 6).forEach(n => {
      const np = MAP.pts.find(p => p.id === n.id); if (!np) return;
      const [nx, ny] = worldToScreen(np.wx, np.wy);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.beginPath(); ctx.arc(nx, ny, r + 1.5, 0, 6.2832); ctx.strokeStyle = dark ? "#cdd6ff" : "#3a5ac8"; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.strokeStyle = dark ? "rgba(180,200,255,.5)" : "rgba(60,90,200,.45)"; ctx.lineWidth = 1.2;
    });
    ctx.beginPath(); ctx.arc(hx, hy, r + 3, 0, 6.2832); ctx.fillStyle = pointColor(MAP.hover); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = dark ? "#fff" : "#111"; ctx.stroke();
  }
  // cluster labels (only in cluster mode)
  if (MAP.colorMode === "cluster") {
    ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const c of MAP.centroids) {
      if (c.n < 5 || MAP.muted.has(String(c.cluster))) continue;
      const [sx, sy] = worldToScreen(c.x, c.y);
      if (sx < 0 || sx > MAP.w || sy < 0 || sy > MAP.h) continue;
      const txt = c.label.length > 26 ? c.label.slice(0, 24) + "…" : c.label;
      const wpad = ctx.measureText(txt).width / 2 + 6;
      ctx.fillStyle = dark ? "rgba(20,24,34,.72)" : "rgba(255,255,255,.78)";
      ctx.fillRect(sx - wpad, sy - 9, wpad * 2, 18);
      ctx.fillStyle = dark ? "#e8ecf5" : "#1b2030"; ctx.fillText(txt, sx, sy);
    }
  }
  // lasso path
  if (MAP.lassoPath.length > 1) {
    ctx.beginPath(); ctx.moveTo(MAP.lassoPath[0][0], MAP.lassoPath[0][1]);
    for (const pt of MAP.lassoPath) ctx.lineTo(pt[0], pt[1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(91,141,239,.12)"; ctx.fill();
    ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
}
function nearestPoint(mx, my, maxPx) {
  let best = null, bestD = (maxPx || 9) ** 2;
  for (const p of MAP.pts) {
    if (MAP.matched && !MAP.matched.has(p.id) && MAP.matched.size) { /* still allow hover on faded */ }
    const [sx, sy] = worldToScreen(p.wx, p.wy);
    const d = (sx - mx) ** 2 + (sy - my) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
function wireMap() {
  MAP.wired = true;
  const cv = MAP.canvas; const tip = $("map-tooltip");
  const relPos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener("mousedown", e => {
    const [mx, my] = relPos(e); MAP.last = [mx, my]; MAP.moved = false;
    if (MAP.lasso) { MAP.lassoPath = [[mx, my]]; MAP.dragging = true; }
    else { MAP.panning = true; }
  });
  window.addEventListener("mousemove", e => {
    if (!MAP.ready || (state.view !== "map")) return;
    const [mx, my] = relPos(e);
    if (MAP.panning && MAP.last) {
      MAP.tf.x += mx - MAP.last[0]; MAP.tf.y += my - MAP.last[1]; MAP.last = [mx, my]; MAP.moved = true; drawMap(); return;
    }
    if (MAP.dragging && MAP.lasso) { MAP.lassoPath.push([mx, my]); MAP.moved = true; drawMap(); return; }
    // hover
    if (mx < 0 || my < 0 || mx > MAP.w || my > MAP.h) { if (MAP.hover) { MAP.hover = null; tip.hidden = true; drawMap(); } return; }
    const p = nearestPoint(mx, my, 9);
    if (p !== MAP.hover) {
      MAP.hover = p; drawMap();
      if (p) {
        const sum = p.t._summary || (p.t.abstract ? p.t.abstract.slice(0, 110) + "…" : "");
        tip.innerHTML = `<div class="mt-title">${escapeHtml(p.t.title)}</div>
          <div class="mt-sub">${escapeHtml(shortDay(p.t.dayLabel))}${p.t.start ? " · " + escapeHtml(p.t.start) : ""} · ${escapeHtml(typeLabel(p.t.type))}${p.t.spk && p.t.spk.length ? " · " + escapeHtml(p.t.spk[0]) : ""}</div>
          ${sum ? `<div class="mt-sum">${escapeHtml(sum)}</div>` : ""}
          <div class="mt-cl">${escapeHtml(MAP.clusterColors.length ? (window.AIEWF_VEC.clusterLabels[p.cluster] || "") : "")}</div>`;
        tip.hidden = false;
        let tx = mx + 14, ty = my + 14;
        if (tx + 240 > MAP.w) tx = mx - 254; if (ty + 120 > MAP.h) ty = my - 130;
        tip.style.left = tx + "px"; tip.style.top = ty + "px";
      } else tip.hidden = true;
    }
  });
  window.addEventListener("mouseup", () => {
    if (MAP.dragging && MAP.lasso && MAP.lassoPath.length > 2) {
      MAP.pts.forEach(p => { const [sx, sy] = worldToScreen(p.wx, p.wy); if (pointInPoly(sx, sy, MAP.lassoPath)) MAP.selected.add(p.id); });
      updateSelbar();
    }
    MAP.dragging = false; MAP.panning = false; MAP.lassoPath = []; MAP.last = null; drawMap();
  });
  cv.addEventListener("click", () => {
    if (MAP.moved) return;
    if (MAP.hover) openDetail(MAP.hover.id);
  });
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const [mx, my] = relPos(e);
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.min(40, Math.max(0.6, MAP.tf.scale * f));
    const k = ns / MAP.tf.scale;
    // keep cursor anchored
    MAP.tf.x = mx - (mx - MAP.tf.x) * k; MAP.tf.y = my - (my - MAP.tf.y) * k;
    MAP.tf.scale = ns; drawMap();
  }, { passive: false });
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function buildMapLegend() {
  const host = $("map-legend"); if (!host) return;
  let items = [];
  if (MAP.colorMode === "type") items = Object.keys(TYPE_COLORS).map(k => ({ key: k, label: typeLabel(k), color: TYPE_COLORS[k] }));
  else if (MAP.colorMode === "day") items = Object.keys(DAY_COLORS).map(k => ({ key: k, label: shortDay(k), color: DAY_COLORS[k] }));
  else items = MAP.centroids.slice().sort((a, b) => b.n - a.n).map(c => ({ key: String(c.cluster), label: c.label, color: MAP.clusterColors[c.cluster] }));
  const wasOpen = host.classList.contains("open");
  if (!host.classList.contains("collapsed") && !wasOpen) host.classList.add("collapsed");
  const body = items.map(it =>
    `<button class="leg-item${MAP.muted.has(it.key) ? " muted" : ""}" data-leg="${escapeHtml(it.key)}">
      <span class="leg-dot" style="background:${it.color}"></span>${escapeHtml(it.label)}</button>`).join("");
  host.innerHTML =
    `<button class="leg-toggle" data-leg-toggle aria-expanded="${wasOpen ? "true" : "false"}">
      <span>Legend</span>
      <svg class="leg-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="leg-body">${body}</div>`;
  host.querySelector("[data-leg-toggle]").addEventListener("click", () => {
    const open = host.classList.toggle("open");
    host.classList.toggle("collapsed", !open);
    host.querySelector("[data-leg-toggle]").setAttribute("aria-expanded", open ? "true" : "false");
  });
  host.querySelectorAll("[data-leg]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.leg; if (MAP.muted.has(k)) MAP.muted.delete(k); else MAP.muted.add(k);
    b.classList.toggle("muted"); drawMap();
  }));
}
function updateSelbar() {
  const bar = $("map-selbar"); if (!bar) return;
  bar.hidden = MAP.selected.size === 0;
  $("map-selcount").textContent = `${MAP.selected.size} selected`;
}
function wireMapToolbar() {
  $("map-color").addEventListener("change", e => { MAP.colorMode = e.target.value; MAP.muted.clear(); buildMapLegend(); drawMap(); });
  $("map-lasso").addEventListener("click", () => {
    MAP.lasso = !MAP.lasso;
    $("map-lasso").classList.toggle("active", MAP.lasso);
    MAP.canvas && (MAP.canvas.style.cursor = MAP.lasso ? "crosshair" : "grab");
    $("map-hint").textContent = MAP.lasso ? "Drag to lasso-select talks · release to capture" : "Scroll to zoom · drag to pan · hover for detail · click to open";
  });
  $("map-reset").addEventListener("click", () => { fitView(); MAP.muted.clear(); buildMapLegend(); drawMap(); });
  $("map-sel-clear").addEventListener("click", () => { MAP.selected.clear(); updateSelbar(); drawMap(); });
  $("map-sel-save").addEventListener("click", () => {
    let n = 0; MAP.selected.forEach(id => { if (!favs.has(id)) { favs.add(id); n++; } });
    store.set(LS.favs, [...favs]); renderFavCount(); drawMap();
    toast(`Added ${n} talk${n !== 1 ? "s" : ""} to My Events`);
  });
  $("map-sel-filter").addEventListener("click", () => {
    if (!MAP.selected.size) return;
    state.pinned = new Set(MAP.selected); setView("list"); render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("resize", debounce(() => { if (state.view === "map" && MAP.ready) { sizeCanvas(); drawMap(); } }, 150));
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
  els.askExamplesToggle.addEventListener("click", () => setExamplesShown(els.askSuggest.hidden));

  els.sort.addEventListener("change", () => { state.sort = els.sort.value; render(); });
  els.viewSwitch.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { setView(b.dataset.view); render(); }));
  wireMapToolbar();
  if (els.askSem) els.askSem.addEventListener("click", openSettings);

  $("btn-theme").addEventListener("click", () => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    if (state.view === "map" && MAP.ready) drawMap();
  });
  $("btn-myevents").addEventListener("click", openMyEvents);
  $("btn-settings").addEventListener("click", openSettings);
  $("btn-search").addEventListener("click", () => toggleSearchBar());
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
      e.preventDefault(); toggleSearchBar(true);
    }
  });
}
function closeMobileFilters() { els.sidebar.classList.remove("open"); els.sidebarScrim.hidden = true; }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
