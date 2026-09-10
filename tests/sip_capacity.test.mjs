import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCalendar} from '../server/calendar.mjs';
import {makeMarketData} from '../server/market-data.mjs';
import {connectSip} from '../server/ingestion.mjs';
import {normalizeMinuteBar} from '../server/minute-bars.mjs';
import {subscriptionLoader} from '../server/subscriptions.mjs';
import {supervise} from '../server/sip-worker.mjs';
class Socket {
 handlers={};sent=[];closed=false;
 addEventListener(k,f){this.handlers[k]=f;}
 send(x){this.sent.push(JSON.parse(x));}
 close(){this.closed=true;}
 emit(rows){this.handlers.message({data:JSON.stringify(rows)});}
}
const at='2026-09-09T13:30:00.123456Z';
const options={symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,fetchImpl:async()=>Response.json({trades:{}}),calendar:async()=> 'regular',now:()=>at,store:async()=>{}};
test('calendar caches ICU/date/session work and shares concurrent day fetches',async()=>{
 let requests=0;const calendar=makeCalendar({keyId:'TEST',secret:'TEST',fetchImpl:async()=>{requests++;return Response.json([{date:'2026-09-09',open:'09:30',close:'16:00'}]);}});
 assert.deepEqual(await Promise.all([calendar(at),calendar(at)]),['regular','regular']);
 const baseline=process.memoryUsage().rss,started=performance.now();
 for(let i=0;i<200000;i++)assert.equal(await calendar(at),'regular');
 assert.equal(requests,1);
 const increase=process.memoryUsage().rss-baseline;
 assert(increase<96*1024*1024,`unexpected calendar RSS growth ${increase}`);
 console.log(JSON.stringify({benchmark:'200000_cached_calendar_calls',ms:Math.round(performance.now()-started),rss_increase_bytes:increase}));
 assert.equal(await calendar('2026-09-09T13:29:59.999Z'),'extended');
 assert.equal(await calendar('2026-09-09T20:00:00Z'),'extended');
});
test('200000 replay trades stream page-by-page without retained result accumulation',async()=>{
 let pages=0,persisted=0;const api=makeMarketData({...options,fetchImpl:async()=>{
  assert.equal(persisted,pages*10000,'next page fetched before preceding durable consumer completed');
  const index=++pages;return Response.json({trades:{SPY:Array.from({length:10000},(_,i)=>({p:100,i:index*10000+i,t:at}))},next_page_token:index<20?String(index):null});
 }});
 const result=await api.backfillTrades(['SPY'],'2026-09-09T13:00:00Z','2026-09-09T14:00:00Z',{onPage:async rows=>{assert.equal(rows.length,10000);persisted+=rows.length;}});
 assert.equal(persisted,200000);assert.equal(result.records.length,0);assert.equal(result.coverage_complete,true);
});
test('tiered discovery keeps every required candidate/position raw, other research in bars',async()=>{
 const load=subscriptionLoader({url:'https://fglbxoafbebsryjeqcbu.supabase.co',serviceRole:'TEST',seed:['SPY','QQQ','ADBE'],tiered:true,
  fetchImpl:async url=>Response.json(String(url).includes('watchlist')?[{symbol:'AAPL'},{symbol:'ADBE'},{symbol:'NVDA'}]:String(url).includes('trade_proposals')?[{symbol:'NVDA'}]:[{symbol:'MSFT'}])});
 assert.deepEqual(await load(),{symbols:['ADBE','MSFT','NVDA','QQQ','SPY'],barSymbols:['AAPL']});
 const unsafe=subscriptionLoader({url:'https://fglbxoafbebsryjeqcbu.supabase.co',serviceRole:'TEST',tiered:true,fetchImpl:async()=>Response.json(Array.from({length:31},(_,i)=>({symbol:'T'+i})))});
 await assert.rejects(unsafe,/raw stream capacity/);
});
test('bars and updated bars never enter raw crossing storage; delayed persistence retains socket receipt time',async()=>{
 let clock=at;const socket=new Socket(),trades=[],bars=[];
 const worker=await connectSip({...options,barSymbols:['AAPL'],now:()=>clock,socketFactory:()=>socket,store:async rows=>trades.push(...rows),storeBars:async rows=>bars.push(...rows)});
 socket.emit([{T:'subscription',trades:['SPY'],bars:['AAPL'],updatedBars:['AAPL']}]);await worker.drain();
 const bar={T:'b',S:'AAPL',t:'2026-09-09T13:29:00Z',o:100,h:103,l:99,c:101,v:1000};
 socket.emit([bar,{...bar,T:'u',h:104,v:1200},{T:'t',S:'SPY',t:at,p:102,i:1},{T:'t',S:'SPY',t:at,p:99,i:2}]);
 clock='2026-09-09T13:30:10Z';await worker.drain();
 assert.deepEqual(trades.map(r=>r.last),[102,99]);assert.equal(trades[0].received_at,at);
 assert.equal(bars.length,2);assert.notEqual(bars[0].source_id,bars[1].source_id);
 assert.deepEqual(normalizeMinuteBar(bar,{receivedAt:clock}).source_id,bars[0].source_id);
 const health=await worker.checkHealth();assert.equal(health.research_symbol_count,1);assert.deepEqual(health.stale_research_symbols,[]);worker.stop();
});
test('memory limit and oversized frames fail before parse/queue growth',async()=>{
 const socket=new Socket();let rss=64*1024*1024;
 const worker=await connectSip({...options,socketFactory:()=>socket,memoryUsage:()=>rss});
 socket.emit([{T:'subscription',trades:['SPY']}]);await worker.drain();rss=385*1024*1024;
 socket.emit([{T:'t',S:'SPY',t:at,p:100,i:1}]);await worker.drain();
 assert.equal(worker.failure(),'stream_memory_pressure_gap');assert(socket.closed);
});
test('heartbeat is not blocked waiting for a continuous live drain',async()=>{
 let beats=0,drains=0;const abort=new AbortController();
 await supervise({signal:abort.signal,sleep:async()=>{},onHeartbeat:async()=>{beats++;abort.abort();},connect:async()=>({isHealthy:()=>true,isConnected:()=>true,checkHealth:async()=>({status:'coverage_unknown_or_stale'}),drain:async()=>{drains++;assert(abort.signal.aborted,'drain called on heartbeat path');},stop:()=>{}})});
 assert.equal(beats,1);assert.equal(drains,1);
});
test('busy catch-up does not hold the live writer behind REST recovery',async()=>{
 const socket=new Socket(),stored=[];let clock='2026-09-09T13:29:59Z',requests=0,release;
 const held=new Promise(r=>{release=r});
 const worker=await connectSip({...options,now:()=>clock,socketFactory:()=>socket,store:async rows=>stored.push(...rows),fetchImpl:async()=>{if(++requests>1)await held;return Response.json({trades:{}});}});
 clock=at;socket.emit([{T:'subscription',trades:['SPY']}]);
 socket.emit([{T:'t',S:'SPY',t:at,p:101,i:10}]);
 await new Promise(r=>setImmediate(r));assert.equal(stored.length,1);assert.equal(stored[0].gap,true);
 release();await worker.drain();worker.stop();
});
