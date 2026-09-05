import test from 'node:test';import assert from 'node:assert/strict';
import {makeDiscovery,tiingoDirectory} from '../server/discovery.mjs';
import {streamUniverse,subscriptionLoader} from '../server/subscriptions.mjs';
import {ensureResearchWatchlist} from '../supabase/functions/morrow-bridge/watchlist.mjs';
const config={alpacaKey:'TEST',alpacaSecret:'TEST-secret',alpacaLicensed:true,alpacaArchiveApproved:true,alpacaDisplayAllowed:true,tiingoKey:'TEST',tiingoLicensed:true,tiingoArchiveApproved:true,tiingoDisplayAllowed:true,tiingoNewsApproved:true};
test('Alpaca universe is paged across supported stocks, never tied to the watchlist',async()=>{
 let requests=0;const gateway=makeDiscovery({config,fetchImpl:async(url,o)=>{requests++;assert.equal(o.method,'GET');assert.match(String(url),/paper-api.alpaca.markets\/v2\/assets/);return Response.json(['AAPL','MSFT','SPY'].map(symbol=>({symbol,name:symbol,class:'us_equity',status:'active',exchange:'NASDAQ'})));}});
 const first=await gateway({action:'universe',limit:2}),second=await gateway({action:'universe',offset:first.next_offset,limit:2});assert.equal(first.total,3);assert.deepEqual(second.data.map(r=>r.symbol),['SPY']);assert.equal(second.next_offset,null);assert.equal(requests,1);
});
test('Tiingo market-wide discovery omits ticker filters; narrower news and metadata remain available',async()=>{
 const seen=[];const gateway=makeDiscovery({config,fetchImpl:async(url,o)=>{seen.push(String(url));assert.equal(o.headers.Authorization,'Token TEST');assert(!String(url).includes('TEST'));return Response.json(String(url).includes('/news')?[]:{ticker:'AAPL',startDate:'1980-12-12',endDate:'2026-09-04'});}});
 assert.equal((await gateway({provider:'tiingo',action:'news'})).status,'ok');assert(!seen[0].includes('tickers='));
 await gateway({provider:'tiingo',action:'news',symbols:['NVDA']});assert.match(seen[1],/tickers=NVDA/);
 assert.equal((await gateway({provider:'tiingo',action:'metadata',symbol:'AAPL'})).data.symbol,'AAPL');
});
test('missing permissions and invalid requests never access providers',async()=>{
 const denied=makeDiscovery({config:{},fetchImpl:()=>{throw Error('must not fetch')}});assert.equal((await denied({provider:'tiingo',action:'news'})).status,'blocked');
 const gateway=makeDiscovery({config,fetchImpl:()=>{throw Error('must not fetch')}});
 await assert.rejects(()=>gateway({action:'history',symbol:'AAPL',start:'2026-02-30',end:'2026-03-02'}),/interval/);
 await assert.rejects(()=>gateway({action:'orders'}),/unsupported/);
 await assert.rejects(()=>gateway({provider:'tiingo',action:'metadata',symbol:'../../orders'}),/universe/);
});
test('stream symbols combine scouts, active research and open paper exposure',async()=>{
 const load=subscriptionLoader({url:'https://fglbxoafbebsryjeqcbu.supabase.co',serviceRole:'TEST',fetchImpl:async url=>Response.json([{symbol:String(url).includes('watchlist')?'AAPL':String(url).includes('trade_proposals')?'NVDA':'MSFT'}])});assert.deepEqual(await load(),['AAPL','MSFT','NVDA','QQQ','SPY']);assert.equal(streamUniverse(Array.from({length:74},(_,i)=>'T'+i)).length,74);assert.throws(()=>streamUniverse(Array.from({length:501},(_,i)=>'T'+i)),/capacity/);
});
test('watchlist sync preserves existing notes, verifies writes, and reports retryable failures',async()=>{
 let row={symbol:'AAPL',note:'Original scout'};
 const db={from(){return {upsert:async(value,options)=>{assert.deepEqual(value,{symbol:'AAPL'});assert(options.ignoreDuplicates);return {error:null}},select(){return this},eq(){return this},single:async()=>({data:row})}}};
 assert.deepEqual(await ensureResearchWatchlist(db,'AAPL'),{symbol:'AAPL',verified:true});assert.equal(row.note,'Original scout');
 row=null;await assert.rejects(()=>ensureResearchWatchlist(db,'AAPL'),/readback/);
});
test('Tiingo directories reject broken archives instead of returning an empty universe',async()=>{await assert.rejects(()=>tiingoDirectory(new Uint8Array(24)),/archive/);});
test('stock stream excludes legacy crypto but cannot silently omit open exposure',async()=>{
 const {alpacaAssetResolver}=await import('../server/subscriptions.mjs');const notes=[];
 const resolve=alpacaAssetResolver({keyId:'TEST',secret:'TEST',onExcluded:async rows=>notes.push(rows),fetchImpl:async()=>Response.json([{symbol:'SPY',class:'us_equity',status:'active',exchange:'ARCA'}])});
 assert.deepEqual(await resolve(['SPY','BTC-USD']),['SPY']);assert.deepEqual(notes,[['BTC-USD']]);await assert.rejects(()=>resolve(['SPY','BTC-USD'],['BTC-USD']),/open paper/);
});
