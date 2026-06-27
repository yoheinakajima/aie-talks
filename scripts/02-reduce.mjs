// UMAP 2D projection + k-means clustering + nearest neighbors over the talk vectors.
import { UMAP } from 'umap-js';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
global.window = {};
require('../data.js');
const talks = global.window.AIEWF.talks;
const SCRATCH = process.env.SCRATCH;

const { dim, ids, vectors } = JSON.parse(fs.readFileSync(SCRATCH + '/vectors.json', 'utf8'));
const V = vectors.map(v => Float32Array.from(v));
const N = V.length;

// seeded PRNG for reproducible UMAP/k-means
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}; // vectors are L2-normalized => dot == cosine

// ---- UMAP 2D ----
process.stderr.write('UMAP...\n');
const rng = mulberry32(42);
const umap = new UMAP({ nComponents:2, nNeighbors:15, minDist:0.1, spread:1.0, random:rng });
let coords = umap.fit(V.map(v=>Array.from(v)));
// normalize coords to [-1,1] on each axis
const xs=coords.map(c=>c[0]), ys=coords.map(c=>c[1]);
const nx=(v,a)=>{const mn=Math.min(...a),mx=Math.max(...a);return (2*(v-mn)/(mx-mn))-1;};
coords = coords.map(c=>[+nx(c[0],xs).toFixed(4), +nx(c[1],ys).toFixed(4)]);

// ---- k-means (cosine, on full-dim normalized vectors) ----
const K = +(process.env.K||20);
process.stderr.write(`k-means K=${K}...\n`);
const rk = mulberry32(7);
// k-means++ init
let centers=[]; centers.push(Array.from(V[Math.floor(rk()*N)]));
while(centers.length<K){
  const d2 = V.map(v=>{let best=Infinity;for(const c of centers){const s=1-dot(v,c);if(s<best)best=s;}return best*best;});
  const sum=d2.reduce((a,b)=>a+b,0); let r=rk()*sum,idx=0;
  for(let i=0;i<N;i++){r-=d2[i];if(r<=0){idx=i;break;}}
  centers.push(Array.from(V[idx]));
}
let assign=new Array(N).fill(0);
for(let iter=0;iter<50;iter++){
  let moved=0;
  for(let i=0;i<N;i++){let best=-1,bi=0;for(let k=0;k<K;k++){const s=dot(V[i],centers[k]);if(s>best){best=s;bi=k;}}if(assign[i]!==bi){assign[i]=bi;moved++;}}
  const sums=Array.from({length:K},()=>new Float64Array(dim)); const cnt=new Array(K).fill(0);
  for(let i=0;i<N;i++){const a=assign[i];cnt[a]++;for(let d=0;d<dim;d++)sums[a][d]+=V[i][d];}
  for(let k=0;k<K;k++){if(!cnt[k])continue;let nrm=0;for(let d=0;d<dim;d++)nrm+=sums[k][d]*sums[k][d];nrm=Math.sqrt(nrm)||1;centers[k]=Array.from(sums[k],x=>x/nrm);}
  if(moved===0)break;
}

// ---- nearest neighbors (top 8, cosine) ----
process.stderr.write('neighbors...\n');
const neighbors = [];
for(let i=0;i<N;i++){
  const sims=[];
  for(let j=0;j<N;j++){if(j===i)continue;sims.push([j,dot(V[i],V[j])]);}
  sims.sort((a,b)=>b[1]-a[1]);
  neighbors.push(sims.slice(0,8).map(([j,s])=>({id:ids[j],s:+s.toFixed(4)})));
}

// cluster membership lists (for labeling)
const clusters=Array.from({length:K},()=>[]);
assign.forEach((a,i)=>clusters[a].push(i));

const out = {
  dim, ids, coords, clusterK:K, cluster:assign, neighbors,
  // member talk titles per cluster, ordered by closeness to centroid, for labeling
  clusterMembers: clusters.map((mem,k)=>{
    const ranked = mem.map(i=>[i,dot(V[i],centers[k])]).sort((a,b)=>b[1]-a[1]);
    return ranked.map(([i])=>({id:ids[i], title:talks[i].title, tags:talks[i].tags}));
  })
};
fs.writeFileSync(SCRATCH+'/reduced.json', JSON.stringify(out));
// also dump a compact cluster summary for labeling agents
const summary = out.clusterMembers.map((mem,k)=>({cluster:k, size:mem.length, titles:mem.slice(0,14).map(m=>m.title)}));
fs.writeFileSync(SCRATCH+'/cluster_summary.json', JSON.stringify(summary,null,1));
process.stderr.write(`done -> reduced.json (K=${K})\n`);
for(const s of summary) process.stderr.write(`  c${s.cluster} (${s.size}): ${s.titles.slice(0,4).join(' | ')}\n`);
