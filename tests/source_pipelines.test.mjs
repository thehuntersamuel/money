import test from 'node:test';import assert from 'node:assert/strict';
import {fetchSource} from '../server/source-pipelines.mjs';
const now=()=> '2026-09-05T15:00:00Z';
test('news needs dataset and archive approval and remains discovery-only',async()=>{
 let requests=0;const config={tiingoKey:'TEST',tiingoLicensed:true,tiingoNewsApproved:true,tiingoArchiveApproved:true};
 const fetchImpl=async(url,options)=>{requests++;assert.equal(url.hostname,'api.tiingo.com');assert(!url.href.includes('TEST'));assert.equal(options.headers.Authorization,'Token TEST');return Response.json([{id:1,title:'TEST news',url:'https://example.com/a?tracking=1',publishedDate:'2026-09-04T15:00:00Z',crawlDate:'2026-09-04T15:01:00Z',tickers:['SPY']}]);};
 assert((await fetchSource({dataset:'tiingo_news',symbols:['SPY']},{config:{},fetchImpl,now})).blocked);assert.equal(requests,0);
 const r=await fetchSource({dataset:'tiingo_news',symbols:['SPY']},{config,fetchImpl,now});assert.equal(r.payload[0].source_type,'news_discovery');assert.equal(r.payload[0].primary_verification_required,true);assert.equal(r.payload[0].url,'https://example.com/a');assert.match(r.provenance.content_sha256,/^[a-f0-9]{64}$/);
});
test('BLS revised history never claims historical point-in-time availability',async()=>{
 const r=await fetchSource({dataset:'bls_series',series_ids:['CUUR0000SA0'],start_year:2025,end_year:2026},{config:{},now,fetchImpl:async(u,o)=>{assert.equal(o.method,'POST');assert.equal(u.pathname,'/publicAPI/v1/timeseries/data/');return Response.json({status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:'CUUR0000SA0',data:[{year:'2025',period:'M01',value:'100'}]}]}});}});
 assert.equal(r.payload.historical_decision_eligible,false);assert.equal(r.payload.vintage_at,null);
});
test('FRED requires prior-day vintage, refuses truncation, and strips key from provenance',async()=>{
 const input={dataset:'fred_vintage',series_id:'GDP',vintage:'2026-09-03',start:'2025-01-01',end:'2026-09-03',decision_at:'2026-09-04T15:00:00Z'};
 await assert.rejects(()=>fetchSource({...input,decision_at:'2026-09-04T00:00:00+14:00'},{config:{fredKey:'TEST'},now}),/precede/);
 await assert.rejects(()=>fetchSource({...input,vintage:'2026-09-04'},{config:{fredKey:'TEST'},now}),/precede/);
 const r=await fetchSource(input,{config:{fredKey:'TEST'},now,fetchImpl:async u=>{assert.equal(u.searchParams.get('realtime_end'),input.vintage);return Response.json({count:1,observations:[{date:'2026-01-01',value:'.',realtime_start:input.vintage,realtime_end:input.vintage}]});}});
 assert.equal(r.payload.observations[0].value,null);assert(!JSON.stringify(r).includes('TEST'));assert.equal(r.provenance.url,'https://api.stlouisfed.org/fred/series/observations');
});
test('primary documents reject arbitrary hosts and retain fingerprint without invented publication time or excerpts',async()=>{
 const config={secUserAgent:'Morrow research contact@example.test'};
 await assert.rejects(()=>fetchSource({dataset:'primary_document',url:'http://127.0.0.1/private'},{config,now}),/approved/);
 const r=await fetchSource({dataset:'primary_document',url:'https://www.bea.gov/news'},{config,now,fetchImpl:async()=>new Response('TEST primary content')});
 assert.equal(r.payload.released_at,null);assert.equal(r.payload.excerpt,null);assert.match(r.payload.content_sha256,/^[a-f0-9]{64}$/);
});

test('BLS refuses a nominal success that omits requested data',async()=>{
 await assert.rejects(()=>fetchSource({dataset:'bls_series',series_ids:['CUUR0000SA0'],start_year:2025,end_year:2026},{config:{},now,fetchImpl:async()=>Response.json({status:'REQUEST_SUCCEEDED',Results:{series:[]}})}),/series missing/);
});
