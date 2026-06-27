// Merge keyphrases + vectors + reduction into front-end build artifacts.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
global.window = {};
require('../data.js');
const talks = global.window.AIEWF.talks;
const SCRATCH = process.env.SCRATCH;
const OUTDIR = process.env.OUTDIR; // repo /data

const CLUSTER_LABELS = [
  "LLM Inference & Serving at Scale",
  "AI Security & Agent Internals",
  "Local & On-Device AI",
  "Forward-Deployed Engineering",
  "Context Engineering & Memory",
  "Agentic Architecture for AI-Native Systems",
  "Agent Training, Memory & Self-Improvement",
  "Voice & Realtime Multimodal Agents",
  "Design, Taste & Generative Media",
  "Graph Databases & Knowledge Graphs",
  "Coding Agents & Software Factories",
  "MCP & Generative UI",
  "Enterprise AI Adoption & Governance",
  "Agent Evals & Observability",
  "AI-Assisted Dev Workflows",
  "World Models, Robotics & Edge Agents",
  "Search, Retrieval & AutoResearch",
  "Expo / Sponsor Sessions",
  "Agent Platforms & Orchestration",
  "Open Source & Model Infrastructure",
];

// ---- merge keyphrases ----
const kpDir = SCRATCH + '/keyphrases';
const enrich = {};
let dupWarn = 0;
for (const f of fs.readdirSync(kpDir).filter(f=>f.endsWith('.out.json'))) {
  const arr = JSON.parse(fs.readFileSync(kpDir + '/' + f, 'utf8'));
  for (const o of arr) {
    if (enrich[o.id]) dupWarn++;
    enrich[o.id] = {
      keyphrases: [...new Set((o.keyphrases||[]).map(s=>String(s).toLowerCase().trim()).filter(Boolean))],
      entities: [...new Set((o.entities||[]).map(s=>String(s).toLowerCase().trim()).filter(Boolean))],
      summary: (o.summary||'').trim()
    };
  }
}
const missing = talks.filter(t=>!enrich[t.id]).map(t=>t.id);
console.log(`keyphrases: ${Object.keys(enrich).length} talks, ${missing.length} missing, ${dupWarn} dup ids`);
if (missing.length) console.log('  MISSING:', missing.slice(0,20).join(', '));

// keyphrase vocabulary stats
const kpFreq = {};
Object.values(enrich).forEach(e=>e.keyphrases.forEach(k=>kpFreq[k]=(kpFreq[k]||0)+1));
const vocab = Object.entries(kpFreq).sort((a,b)=>b[1]-a[1]);
console.log(`keyphrase vocab: ${vocab.length} unique. top:`, vocab.slice(0,15).map(([k,v])=>`${k}(${v})`).join(', '));

// ---- vectors -> int8 quantized, base64 ----
const { dim, ids, vectors } = JSON.parse(fs.readFileSync(SCRATCH + '/vectors.json', 'utf8'));
const SCALE = 127; // L2-normalized components are within [-1,1]
const buf = Buffer.alloc(ids.length * dim);
let clip = 0;
for (let i=0;i<ids.length;i++) for (let d=0;d<dim;d++){
  let q = Math.round(vectors[i][d]*SCALE);
  if (q>127){q=127;clip++;} if(q<-127){q=-127;clip++;}
  buf[i*dim+d] = q & 0xff; // store as signed via two's complement byte
}
const vb64 = buf.toString('base64');
console.log(`vectors: ${ids.length}x${dim} int8, ${clip} clipped, base64 ${(vb64.length/1024).toFixed(0)}KB`);

// ---- reduction ----
const red = JSON.parse(fs.readFileSync(SCRATCH + '/reduced.json', 'utf8'));

// ---- emit: enriched.js (keyphrases/summaries) ----
fs.mkdirSync(OUTDIR, {recursive:true});
const enrichOrdered = {};
ids.forEach(id=>{ if(enrich[id]) enrichOrdered[id]=enrich[id]; });
fs.writeFileSync(OUTDIR+'/enriched.js',
  'window.AIEWF_ENRICH = ' + JSON.stringify(enrichOrdered) + ';\n');

// ---- emit: vectors.js (semantic search + map) ----
const vecArtifact = {
  model: 'Xenova/all-MiniLM-L6-v2@q8',
  dim, scale: SCALE, count: ids.length,
  ids,
  vectorsB64: vb64,           // int8, row-major, decode: signed byte / scale
  coords: red.coords,         // UMAP 2D in [-1,1]
  clusterK: red.clusterK,
  cluster: red.cluster,       // cluster index per talk (parallel to ids)
  clusterLabels: CLUSTER_LABELS,
  neighbors: red.neighbors,   // top-8 {id,s} per talk (parallel to ids)
};
fs.writeFileSync(OUTDIR+'/vectors.js',
  'window.AIEWF_VEC = ' + JSON.stringify(vecArtifact) + ';\n');

// ---- copy analysis.json into data for reference ----
fs.copyFileSync(SCRATCH+'/analysis.json', OUTDIR+'/analysis.json');

// sizes
for (const f of ['enriched.js','vectors.js','analysis.json']) {
  const kb = (fs.statSync(OUTDIR+'/'+f).size/1024).toFixed(0);
  console.log(`  data/${f}: ${kb}KB`);
}
console.log('done.');
