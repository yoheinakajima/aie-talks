import { embed } from '@plurnk/plurnk-mimetypes-embeddings';
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url);
global.window={}; require('../data.js'); require('../data/vectors.js'); require('../data/enriched.js');
const talks=Object.fromEntries(global.window.AIEWF.talks.map(t=>[t.id,t]));
const VEC=global.window.AIEWF_VEC; const EN=global.window.AIEWF_ENRICH;
const {dim,scale,ids,vectorsB64}=VEC;
const raw=Buffer.from(vectorsB64,'base64');
// decode int8 (two's complement) -> Float32, row-major
function row(i){const v=new Float32Array(dim);for(let d=0;d<dim;d++){let b=raw[i*dim+d];if(b>127)b-=256;v[d]=b/scale;}return v;}
const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};
async function search(q,n=8){
  let e=new Float32Array((await embed(q)).buffer);
  // re-normalize decoded query against quantized space (quantized rows arent exactly unit)
  const scored=ids.map((id,i)=>[id,dot(e,row(i))]).sort((a,b)=>b[1]-a[1]).slice(0,n);
  console.log(`\n=== "${q}" ===`);
  for(const [id,s] of scored){const t=talks[id];console.log(`  ${s.toFixed(3)}  ${t.title}`);
    console.log(`         ↳ ${EN[id].summary} [${EN[id].keyphrases.slice(0,4).join(', ')}]`);}
}
await search('event sourcing');
await search('how do I stop my AI agent from hallucinating');
await search('making models run cheaper and faster');
await search('keeping humans in the loop');
