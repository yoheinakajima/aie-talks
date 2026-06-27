import { embed, dimension } from '@plurnk/plurnk-mimetypes-embeddings';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
global.window = {};
require('../data.js');
const talks = global.window.AIEWF.talks;

function embedText(t){
  const spk = (t.speakers||[]).map(s=>[s.n,s.o].filter(Boolean).join(' ')).join(', ');
  if (t.abstract && t.abstract.trim()){
    return `${t.title}\n\n${t.abstract}`.slice(0, 4000);
  }
  // no abstract: lean on title + speakers + tags + track
  return [t.title, spk, t.topic||'', (t.tags||[]).join(' ')].filter(Boolean).join('. ').slice(0,2000);
}

const OUT = process.env.SCRATCH + '/vectors.json';
const vecs = [];
const t0 = Date.now();
for (let i=0;i<talks.length;i++){
  const v = new Float32Array((await embed(embedText(talks[i]))).buffer);
  vecs.push(Array.from(v));
  if (i%50===0) process.stderr.write(`  ${i}/${talks.length} (${((Date.now()-t0)/1000).toFixed(0)}s)\n`);
}
fs.writeFileSync(OUT, JSON.stringify({dim:dimension, ids: talks.map(t=>t.id), vectors: vecs}));
process.stderr.write(`done ${talks.length} talks in ${((Date.now()-t0)/1000).toFixed(0)}s -> ${OUT}\n`);
