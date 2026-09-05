import test from 'node:test';
import assert from 'node:assert/strict';
import {ingestOnce} from '../server/data-worker.mjs';
function store(fail=false){const writes=[];return {writes,db:{from:table=>({insert:async value=>{writes.push({table,value});return {error:fail?{message:'TEST'}:null};},upsert:async value=>{writes.push({table,value});return {error:fail?{message:'TEST'}:null};}})}};}
test('missing keys write a blocked health receipt without contacting providers',async()=>{
 const s=store();const r=await ingestOnce({dataset:'alpaca_sip'},{config:{},db:s.db,fetchImpl:()=>{throw Error('must not call')}});
 assert.equal(r.status,'blocked');assert.equal(r.coverage,'unknown');assert.equal(s.writes.length,1);assert.equal(s.writes[0].table,'morrow_integration_health');
});
test('Tiingo persists normalized snapshot with raw display disabled by default',async()=>{
 const s=store();const r=await ingestOnce({dataset:'tiingo_eod',symbols:['SPY'],start:'2026-09-04',end:'2026-09-05'},{config:{tiingoKey:'TEST',tiingoLicensed:true,tiingoArchiveApproved:true},db:s.db,fetchImpl:async()=>new Response(JSON.stringify([{date:'2026-09-04T00:00:00Z',close:100,adjClose:95}]))});
 assert.equal(r.status,'ok');assert.equal(s.writes[0].value.display_allowed,false);assert.equal(s.writes[0].value.payload[0].adjusted_close,95);assert.ok(!JSON.stringify(s.writes).includes('Token TEST'));
});
test('persistent health failure prevents a success response',async()=>{
 const s=store(true);await assert.rejects(()=>ingestOnce({dataset:'alpaca_sip'},{config:{},db:s.db}),/health receipt/);
});
test('SIP replay is honestly limited and persists durable observations',async()=>{
 const s=store();const now=()=> '2026-09-04T15:00:00Z';
 const fetchImpl=async url=>url.hostname==='paper-api.alpaca.markets'?new Response(JSON.stringify([{date:'2026-09-04',open:'09:30',close:'16:00'}])):new Response(JSON.stringify({trades:{SPY:[{t:'2026-09-04T14:59:30Z',p:100,i:'TEST'}]},next_page_token:'still-more'}));
 const r=await ingestOnce({dataset:'alpaca_sip',symbols:['SPY']},{config:{alpacaKey:'TEST',alpacaSecret:'TEST',alpacaLicensed:true,alpacaArchiveApproved:true},db:s.db,fetchImpl,now});
 assert.equal(r.coverage,'page_budget_gap');assert.equal(s.writes[0].value[0].gap,true);assert.equal(s.writes[0].value[0].session,'regular');
});
