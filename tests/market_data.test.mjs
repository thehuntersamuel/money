import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMarketData,normalizeTrade,paperFill,normalizeTiingoEod} from '../server/market-data.mjs';
const opts={keyId:'TEST-ID',secret:'TEST-SECRET',licensed:true,sleep:async()=>{}};
test('explicit SIP, bounded GET-only routes, no credential query strings',async()=>{
 const api=makeMarketData({...opts,fetchImpl:async(url,options)=>{assert.equal(url.host,'data.alpaca.markets');assert.equal(url.searchParams.get('feed'),'sip');assert.equal(options.method,'GET');assert(!url.href.includes('SECRET'));return Response.json({quotes:{}});}});
 await api.latestQuotes(['SPY']);await assert.rejects(()=>api.backfillTrades(['SPY'],'bad','bad'),/timestamp/);
 await assert.rejects(()=>makeMarketData({...opts,licensed:false}).latestQuotes(['SPY']),/licensing/);
});
test('429 retries bounded; 401 fails closed without secret/body leakage',async()=>{
 let calls=0; const api=makeMarketData({...opts,fetchImpl:async()=>{calls++;return new Response('TEST-SECRET',{status:429});}});
 await assert.rejects(()=>api.latestQuotes(['SPY']),/status 429/);assert.equal(calls,3);
 calls=0;const denied=makeMarketData({...opts,fetchImpl:async()=>{calls++;return new Response('TEST-SECRET',{status:401});}});
 await assert.rejects(()=>denied.latestQuotes(['SPY']),e=>!e.message.includes('SECRET')&&e.message.includes('401'));assert.equal(calls,1);
});
test('pagination preserves incomplete coverage and detects cursor loops',async()=>{
 const api=makeMarketData({...opts,fetchImpl:async()=>Response.json({trades:{SPY:[]},next_page_token:'again'})});
 const args=[['SPY'],'2026-09-04T14:00:00Z','2026-09-04T14:30:00Z'];
 assert.equal((await api.backfillTrades(...args,{maxPages:1})).coverage_complete,false);
 await assert.rejects(()=>api.backfillTrades(...args),/repeated/);
});
test('observations preserve event time and default to TEST/unknown coverage',()=>{
 const row=normalizeTrade('SPY',{p:100,i:1,t:'2026-09-04T14:00:00Z'},{receivedAt:'2026-09-04T14:00:01Z'});
 assert.notEqual(row.event_at,row.received_at);assert.equal(row.is_test,true);assert.equal(row.gap,true);
 assert.throws(()=>normalizeTrade('SPY',{p:null,i:1,t:row.event_at},{receivedAt:row.received_at}));
});
test('paper fill uses executable side and rejects stale, gap and insufficient size',()=>{
 const q={feed:'sip',gap:false,session:'regular',event_at:'2026-09-04T14:00:00Z',bid:99,ask:101,bid_size:5,ask_size:5,source_id:'TEST'};
 const o={side:'buy',qty:2,now:'2026-09-04T14:00:01Z'};
 assert.equal(paperFill(q,o).price,101);assert.equal(paperFill(q,{...o,side:'sell'}).price,99);
 for(const bad of [{...q,gap:true},{...q,feed:'iex'},{...q,ask_size:1},{...q,event_at:'2026-09-04T13:00:00Z'}])assert.throws(()=>paperFill(bad,o));
});
test('Tiingo raw and adjusted values stay separate, unknown stays null',()=>{
 const r=normalizeTiingoEod('SPY',{date:'2026-09-04T00:00:00Z',close:100,adjClose:50},'2026-09-05T00:00:00Z');
 assert.equal(r.raw_close,100);assert.equal(r.adjusted_close,50);assert.equal(r.dividend,null);
});
