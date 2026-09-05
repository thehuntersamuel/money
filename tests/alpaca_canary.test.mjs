import test from 'node:test';import assert from 'node:assert/strict';
import {checkAlpaca} from '../verification/alpaca_canary.mjs';
const env=k=>({ALPACA_API_KEY_ID:'TEST_KEY',ALPACA_API_SECRET_KEY:'TEST_SECRET'}[k]);
const now=()=>Date.parse('2026-09-05T03:00:00Z');
await test('fixed GET routes, explicit SIP, safe metadata only',async()=>{
 const calls=[];const result=await checkAlpaca({env,now,fetchImpl:async(url,opts)=>{
 calls.push([url,opts]);return new Response(JSON.stringify(url.includes('snapshots')?{SPY:{latestQuote:{bp:100,ap:101,t:'2026-09-05T00:00:00Z'},latestTrade:{p:100.5,t:'2026-09-05T00:00:00Z'}}}:{is_open:false,timestamp:'2026-09-05T03:00:00Z',next_open:'2026-09-08T13:30:00Z'}),{status:200});
 }});assert.equal(result.status,'credentials_and_sip_verified');assert.equal(result.paper_clock.market_open,false);assert.equal(result.ingestion_enabled,false);assert.equal(calls.length,2);assert(calls.every(([u,o])=>o.method==='GET'&&o.redirect==='error'));assert(calls[0][0].endsWith('feed=sip'));assert(!JSON.stringify(result).includes('TEST_SECRET'));assert(!JSON.stringify(result).includes('100.5'));
});
await test('missing keys do not call provider; authorization errors do not leak bodies',async()=>{
 let count=0;const missing=await checkAlpaca({env:()=>undefined,fetchImpl:()=>{count++;throw Error('unexpected');}});assert.equal(count,0);assert.equal(missing.status,'missing_credentials');
 const denied=await checkAlpaca({env,now,fetchImpl:async()=>new Response('TEST_SECRET upstream private error',{status:403})});assert.equal(denied.status,'check_failed');assert.equal(denied.sip.http_status,403);assert(!JSON.stringify(denied).includes('TEST_SECRET'));
});
