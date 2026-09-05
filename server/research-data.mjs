import {universe,normalizeTiingoEod} from './market-data.mjs';
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s));
async function boundedJson(response,maxBytes=8_000_000){
 if(!response.ok)throw Error(`source status ${response.status}`);
 if(Number(response.headers.get('content-length')||0)>maxBytes)throw Error('source response too large');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('source response too large');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function makeTiingo({token,licensed=false,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 return {async eod(symbol,start,end,retrievedAt=new Date().toISOString()){
  universe([symbol]);if(!licensed||!token)throw Error('Tiingo licensing and secure credentials required');
  if(!date(start)||!date(end)||end<start||Date.parse(end)-Date.parse(start)>366*86400000)throw Error('Tiingo interval must be within one year');
  const url=new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices`);url.searchParams.set('startDate',start);url.searchParams.set('endDate',end);
  for(let i=0;i<3;i++){
   let r;try{r=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Token ${token}`,Accept:'application/json'}});}catch{throw Error('Tiingo connection unavailable');}
   if((r.status===429||r.status>=500)&&i<2){await r.body?.cancel();await sleep(500*2**i);continue;}
   const rows=await boundedJson(r);if(!Array.isArray(rows)||rows.length>370)throw Error('invalid Tiingo history');
   return rows.map(row=>normalizeTiingoEod(symbol,row,retrievedAt));
  }
 }};
}
export function makeSec({userAgent,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now()}){
 // Serialize to <=2 requests/s for this client. The supervisor must use one
 // shared client; this is not an assertion about multiple deployed instances.
 let tail=Promise.resolve(),last=0;const cache=new Map();
 async function get(path){
  if(typeof userAgent!=='string'||!/@/.test(userAgent)||userAgent.length>200)throw Error('identifying SEC User-Agent required');
  const cached=cache.get(path);if(cached&&clock()-cached.at<300000)return cached.value;
  const operation=tail.then(async()=>{
   await sleep(Math.max(0,500-(clock()-last)));last=clock();
   let response;try{response=await fetchImpl(new URL(path,'https://data.sec.gov'),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'User-Agent':userAgent,Accept:'application/json'}});}catch{throw Error('SEC unavailable');}
   const value=await boundedJson(response);if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(path,{at:clock(),value});return value;
  });tail=operation.catch(()=>{});return operation;
 }
 const cik=x=>{if(!/^\d{1,10}$/.test(String(x)))throw Error('numeric CIK required');return String(x).padStart(10,'0');};
 return {submissions:id=>get(`/submissions/CIK${cik(id)}.json`),companyFacts:id=>get(`/api/xbrl/companyfacts/CIK${cik(id)}.json`)};
}
export function factsKnownAt(companyFacts,submissions,decisionAt){
 const cutoff=Date.parse(decisionAt);if(!Number.isFinite(cutoff))throw Error('decision time required');
 const recent=submissions?.filings?.recent;if(!recent)throw Error('dated accession availability required');
 const available=new Map();
 for(let i=0;i<(recent.accessionNumber||[]).length;i++){
  const t=recent.acceptanceDateTime?.[i];
  if(typeof t==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(t)&&Date.parse(t)<=cutoff)available.set(recent.accessionNumber[i],t);
 }
 const facts=[];
 for(const [namespace,items] of Object.entries(companyFacts?.facts||{}))for(const [tag,item] of Object.entries(items))for(const [unit,rows] of Object.entries(item.units||{}))for(const row of rows){
  if(available.has(row.accn)&&typeof row.val==='number'&&Number.isFinite(row.val))facts.push({namespace,tag,unit,value:row.val,start:row.start||null,end:row.end,accession:row.accn,form:row.form,accepted_at:available.get(row.accn),filed:row.filed,frame:row.frame||null});
 }
 return {facts,decision_at:decisionAt,coverage:'provided_accessions_only',latest_restatements_not_backdated:true};
}
