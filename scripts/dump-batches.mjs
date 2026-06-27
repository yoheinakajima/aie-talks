import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url);
global.window={}; require('../data.js');
const talks = global.window.AIEWF.talks;
const SCRATCH=process.env.SCRATCH;
const N=12, per=Math.ceil(talks.length/N);
fs.mkdirSync(SCRATCH+'/batches',{recursive:true});
for(let b=0;b<N;b++){
  const slice=talks.slice(b*per,(b+1)*per).map(t=>({
    id:t.id, title:t.title,
    abstract:(t.abstract||'').slice(0,1400),
    tags:t.tags||[], track:t.topic||''
  }));
  fs.writeFileSync(`${SCRATCH}/batches/batch_${String(b).padStart(2,'0')}.json`, JSON.stringify(slice,null,1));
}
console.log('wrote',N,'batches, ~',per,'talks each, total',talks.length);
