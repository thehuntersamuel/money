// Offline market-open workload. No network, orders, or production writes.
import assert from 'node:assert/strict';
import {connectSip} from '../server/ingestion.mjs';
import {makeCalendar} from '../server/calendar.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const at='2026-09-09T13:30:00.123456Z',symbols=['SPY','QQQ','ADBE'];
const writeDelay=Number(process.env.MORROW_TEST_WRITE_DELAY_MS||150),frameSize=Number(process.env.MORROW_TEST_FRAME_SIZE||150),target=Number(process.env.MORROW_TEST_RECORDS||45000);
assert([writeDelay,frameSize,target].every(n=>Number.isInteger(n)&&n>0));assert(frameSize<=1000&&target<=100000);
let message,closed=false,received=0,writes=0,maxBatch=0,maxRss=0,maxPending=0;
const identities=new Set();
const calendar=makeCalendar({keyId:'TEST',secret:'TEST',fetchImpl:async()=>Response.json([{date:'2026-09-09',open:'09:30',close:'16:00'}])});
const worker=await connectSip({symbols,keyId:'TEST',secret:'TEST',licensed:true,now:()=>at,calendar,
 fetchImpl:async()=>Response.json({trades:{}}),
 socketFactory:()=>({addEventListener:(name,fn)=>{if(name==='message')message=fn;},send:()=>{},close:()=>{closed=true;}}),
 store:async rows=>{await sleep(writeDelay);writes++;maxBatch=Math.max(maxBatch,rows.length);for(const row of rows){assert(!identities.has(row.source_id));identities.add(row.source_id);received++;}},
});
message({data:JSON.stringify([{T:'subscription',trades:symbols}])});await worker.drain();
const started=performance.now();
for(let i=0;i<target;i+=frameSize){
 message({data:JSON.stringify(Array.from({length:Math.min(frameSize,target-i)},(_,j)=>({T:'t',S:symbols[(i+j)%3],i:i+j,p:100+(j%3),t:at})))});
 const health=await worker.checkHealth();maxPending=Math.max(maxPending,health.pending_records);maxRss=Math.max(maxRss,health.rss_bytes);
 assert(!closed,worker.failure());await sleep(50);
}
await worker.drain();worker.stop();assert.equal(received,target);assert(maxBatch<=1000);assert(maxRss<384*1024*1024);
console.log(JSON.stringify({test:'offline_market_open',input_records:target,persisted_records:received,duplicates:0,write_delay_ms:writeDelay,writes,max_batch:maxBatch,max_pending:maxPending,max_rss_bytes:maxRss,elapsed_ms:Math.round(performance.now()-started),note:'Synthetic writer: not a live database/session acceptance claim'}));
