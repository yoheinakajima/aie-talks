// Dataset analysis beyond the brief: duplicates, novelty, scheduling, speakers, coverage.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
global.window = {};
require('../data.js');
const D = global.window.AIEWF;
const talks = D.talks;
const SCRATCH = process.env.SCRATCH;
const { ids, vectors } = JSON.parse(fs.readFileSync(SCRATCH + '/vectors.json', 'utf8'));
const V = vectors.map(v => Float32Array.from(v));
const byId = Object.fromEntries(talks.map((t,i)=>[t.id,i]));
const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};
const R = {};

// ---- coverage ----
R.coverage = {
  total: talks.length,
  withAbstract: talks.filter(t=>t.abstract && t.abstract.trim()).length,
  withoutAbstract: talks.filter(t=>!(t.abstract && t.abstract.trim())).length,
  avgAbstractWords: Math.round(talks.filter(t=>t.abstract).reduce((s,t)=>s+t.abstract.split(/\s+/).length,0)/Math.max(1,talks.filter(t=>t.abstract).length)),
  tentative: talks.filter(t=>t.tent).length,
};

// ---- near-duplicate clusters (cosine >= 0.92) via union-find ----
const TH=0.92; const parent=talks.map((_,i)=>i);
const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
for(let i=0;i<V.length;i++)for(let j=i+1;j<V.length;j++){if(dot(V[i],V[j])>=TH){const a=find(i),b=find(j);if(a!==b)parent[a]=b;}}
const groups={}; talks.forEach((t,i)=>{const r=find(i);(groups[r]=groups[r]||[]).push(i);});
R.nearDuplicateGroups = Object.values(groups).filter(g=>g.length>1)
  .map(g=>({size:g.length, ids:g.map(i=>ids[i]), titles:g.map(i=>talks[i].title)}))
  .sort((a,b)=>b.size-a.size);
R.nearDuplicateStats = {
  groups: R.nearDuplicateGroups.length,
  talksInvolved: R.nearDuplicateGroups.reduce((s,g)=>s+g.size,0),
  threshold: TH
};

// ---- novelty / outliers: mean cosine to all others (low = unique) ----
const meanSim = V.map((v,i)=>{let s=0;for(let j=0;j<V.length;j++)if(j!==i)s+=dot(v,V[j]);return s/(V.length-1);});
const order=[...meanSim.keys()].sort((a,b)=>meanSim[a]-meanSim[b]);
R.mostUnique = order.slice(0,15).map(i=>({title:talks[i].title, type:talks[i].type, meanSim:+meanSim[i].toFixed(3)}));
R.mostTypical = order.slice(-10).reverse().map(i=>({title:talks[i].title, meanSim:+meanSim[i].toFixed(3)}));

// ---- speakers / orgs ----
const orgCount={}, spkCount={};
talks.forEach(t=>(t.speakers||[]).forEach(s=>{if(s.o)orgCount[s.o]=(orgCount[s.o]||0)+1;if(s.n)spkCount[s.n]=(spkCount[s.n]||0)+1;}));
R.topOrgs = Object.entries(orgCount).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>({org:k,talks:v}));
R.topSpeakers = Object.entries(spkCount).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>({name:k,talks:v}));
R.speakerStats = { uniqueSpeakers:Object.keys(spkCount).length, uniqueOrgs:Object.keys(orgCount).length,
  talksNoSpeaker: talks.filter(t=>!(t.speakers&&t.speakers.length)).length };

// ---- type x day distribution ----
const days=D.facets.days.map(d=>d.dayLabel||d.name);
const dayLabels=[...new Set(talks.map(t=>t.dayLabel))];
R.typeByDay={};
dayLabels.forEach(d=>{R.typeByDay[d]=Object.fromEntries(D.facets.types.map(ty=>[ty.key, talks.filter(t=>t.dayLabel===d&&t.type===ty.key).length]));});

// ---- tag co-occurrence (top pairs) ----
const pair={};
talks.forEach(t=>{const tg=[...new Set(t.tags||[])];for(let i=0;i<tg.length;i++)for(let j=i+1;j<tg.length;j++){const k=[tg[i],tg[j]].sort().join(' + ');pair[k]=(pair[k]||0)+1;}});
R.topTagPairs = Object.entries(pair).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({pair:k,count:v}));

// ---- schedule density: concurrent talks per 30-min slot, busiest moments ----
const slots={};
talks.forEach(t=>{if(!t.startDT)return;const key=t.startDT;slots[key]=(slots[key]||0)+1;});
R.busiestSlots = Object.entries(slots).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>({start:k,concurrent:v}));
R.scheduleStats = { distinctStartTimes:Object.keys(slots).length,
  maxConcurrent: Math.max(...Object.values(slots)) };

fs.writeFileSync(SCRATCH+'/analysis.json', JSON.stringify(R,null,1));
// console summary
console.log('coverage', R.coverage);
console.log('\nnearDuplicateStats', R.nearDuplicateStats);
console.log('top dup groups:'); R.nearDuplicateGroups.slice(0,8).forEach(g=>console.log(`  [${g.size}] ${g.titles[0]}`));
console.log('\nmost UNIQUE talks:'); R.mostUnique.slice(0,10).forEach(t=>console.log(`  ${t.meanSim}  ${t.title}`));
console.log('\nspeakerStats', R.speakerStats);
console.log('top orgs:', R.topOrgs.slice(0,12).map(o=>`${o.org}(${o.talks})`).join(', '));
console.log('\nscheduleStats', R.scheduleStats);
console.log('busiest slots:', R.busiestSlots.slice(0,6).map(s=>`${s.start}:${s.concurrent}`).join('  '));
console.log('\ntypeByDay'); console.table(R.typeByDay);
