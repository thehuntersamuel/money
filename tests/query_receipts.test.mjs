import test from 'node:test';
import assert from 'node:assert/strict';
import {persistQueryReceipt} from '../supabase/functions/morrow-bridge/query-receipts.mjs';
const approved={tiingoLicensed:true,tiingoArchiveApproved:true,tiingoDisplayAllowed:true,tiingoNewsApproved:true};
const at='2026-09-15T13:47:50Z';
function store({failWrite=false,failRead=false,failHealth=false}={}) {
 const rows=[],health=[];
 return {rows,health,db:{from(table){let insert;
  const q={insert(row){insert=row;return q;},select(){return q;},eq(){return q;},single(){
   if(insert){if(failWrite)return {error:{message:'TEST rejected'}};rows.push({...insert,id:'TEST-snapshot'});return {data:{id:'TEST-snapshot'}};}
   const row=rows[0]; // JSONB can reorder object keys on readback.
   const payload=row?.payload?.map(r=>Object.fromEntries(Object.entries(r).reverse()));
   return failRead?{error:{message:'TEST unavailable'}}:{data:{...row,payload}};
  },then(resolve){if(table==='morrow_integration_health'){if(failHealth)return Promise.resolve({error:{message:'TEST failure'}}).then(resolve);health.push(insert);}return Promise.resolve({error:null}).then(resolve);}};
  return q;
 }}};
}
test('actual history query result is persisted with scope and independently read back',async()=>{
 const s=store(),input={provider:'tiingo',action:'history',symbol:'PLAY',start:'2026-09-01',end:'2026-09-15'};
 const result={status:'ok',data:[{symbol:'PLAY',date:'2026-09-14',close:10}],retrieved_at:at,source:'https://api.tiingo.com/tiingo/daily/PLAY/prices',coverage:'requested_daily_history_window'};
 const receipt=await persistQueryReceipt(s.db,input,result,approved,()=>at);
 assert.equal(receipt.status,'saved');assert.equal(receipt.verified,true);assert.equal(receipt.mutation_calls,2);
 assert.deepEqual(s.rows[0].payload,result.data);assert.deepEqual(s.health[0].metrics.scope.symbols,['PLAY']);
 assert.equal(s.rows[0].provenance.retrieved_at,at);assert.equal(s.health[0].detail,'on_demand_snapshot_saved');
 assert.equal(s.rows[0].display_allowed,true);
});
test('broad and ticker news preserve separate query scopes and remove URL parameters',async()=>{
 for(const symbols of [undefined,['PLAY']]){
  const s=store();const r=await persistQueryReceipt(s.db,{provider:'tiingo',action:'news',symbols},
   {status:'ok',data:[],retrieved_at:at,source:'https://api.tiingo.com/tiingo/news?tickers=PLAY&limit=100',coverage:'result_limit_reached_narrow_time_window',quality:{result_limit_reached:true}},approved,()=>at);
  assert.equal(r.scope.news_scope,symbols?'ticker':'broad');assert.equal(s.rows[0].provenance.url,'https://api.tiingo.com/tiingo/news');
  assert.equal(s.rows[0].provenance.quality.result_limit_reached,true);
 }
});
test('source-news route is covered, but blocked or unapproved data is never persisted',async()=>{
 const s=store(),input={action:'source',dataset:'tiingo_news'};
 const result={status:'ok',payload:[],provenance:{url:'https://api.tiingo.com/tiingo/news',retrieved_at:at},coverage:'sample'};
 assert.equal((await persistQueryReceipt(s.db,input,result,approved,()=>at)).status,'saved');
 for(const config of [{...approved,tiingoArchiveApproved:false},{...approved,tiingoNewsApproved:false}]){
  const no=store();assert.equal((await persistQueryReceipt(no.db,input,result,config)).mutation_calls,0);assert.equal(no.rows.length,0);
 }
 const no=store();assert.equal((await persistQueryReceipt(no.db,input,{status:'blocked'},approved)).mutation_calls,0);
 assert.equal((await persistQueryReceipt(no.db,{provider:'alpaca',action:'quotes'},result,approved)).mutation_calls,0);
});
test('write and readback failures cannot publish healthy status; health failure stays explicit',async()=>{
 const input={provider:'tiingo',action:'history',symbol:'PLAY'};
 const result={status:'ok',data:[],retrieved_at:at,source:'https://api.tiingo.com/tiingo/daily/PLAY/prices'};
 for(const opts of [{failWrite:true},{failRead:true}]){
  const s=store(opts);assert.equal((await persistQueryReceipt(s.db,input,result,approved)).status,'persistence_failed');assert.equal(s.health.length,0);
 }
 const s=store({failHealth:true});assert.equal((await persistQueryReceipt(s.db,input,result,approved)).status,'snapshot_saved_health_failed');
 assert.equal(result.status,'ok'); // A persistence problem must not discard independently usable data.
});
