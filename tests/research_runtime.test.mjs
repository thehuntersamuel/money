import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validateResearch,researchSummary} from '../supabase/functions/morrow-bridge/research.mjs';
import {makeTiingo,factsKnownAt} from '../server/research-data.mjs';
import {evaluateOpportunities,markedDrawdown} from '../server/evaluation.mjs';
const source={url:'https://example.com/TEST',title:'TEST',source_type:'issuer',retrieved_at:'2026-09-05T00:00:00Z',retention_note:'metadata only'};
test('research contract rejects keys, activation, future sources and missing references',()=>{
 assert.equal(validateResearch({kind:'source',idempotency_key:'TEST:source',payload:source}).kind,'source');
 for(const payload of [{...source,api_key:'TEST'},{...source,url:'https://example.com/?token=TEST'},{...source,released_at:'2026-09-06T00:00:00Z'}])assert.throws(()=>validateResearch({kind:'source',idempotency_key:'TEST',payload}));
 assert.throws(()=>validateResearch({kind:'activate',idempotency_key:'TEST',payload:{}}));
 assert.equal(researchSummary([]).new_openings_allowed,false);
});
test('server immutable record idempotency, owner RLS and reference validation',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create table paper_books(id uuid primary key,label text);create function is_owner() returns boolean language sql as $$select false$$;create function morrow_receipt_immutable() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;create table morrow_close_receipts(trade_id uuid,book_id uuid);`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260905020102_morrow_research_runtime.sql',import.meta.url),'utf8'));
 const book='10000000-0000-0000-0000-000000000001';await db.query("insert into paper_books values($1,'Robinhood Savings')",[book]);
 const append=(kind,key,payload)=>db.query('select * from append_morrow_research($1,$2,$3,$4)',[book,kind,key,JSON.stringify(payload)]);
 const a=(await append('source','TEST',source)).rows[0];const b=(await append('source','TEST',source)).rows[0];assert.equal(a.id,b.id);assert.match(a.server_sha256,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>append('source','TEST',{...source,title:'changed'}),/conflict/);
 await assert.rejects(()=>append('decision','TEST:decision',{source_ids:['missing']}),/source reference/);
 await assert.rejects(()=>db.query('delete from morrow_research_records'),/immutable/);
 await db.exec('set role authenticated');assert.equal((await db.query('select * from morrow_research_records')).rows.length,0);
 await assert.rejects(()=>append('audit','TEST:audit',{}),/permission denied/);await db.exec('reset role');
 await db.close();
});
test('Tiingo is gated, bounded and never sends tokens in URLs',async()=>{
 let calls=0;
 const api=makeTiingo({token:'TEST',licensed:true,sleep:async()=>{},fetchImpl:async(url,init)=>{calls++;assert.equal(url.hostname,'api.tiingo.com');assert.equal(url.searchParams.has('token'),false);assert.equal(init.headers.Authorization,'Token TEST');assert.equal(init.redirect,'error');return new Response(JSON.stringify([{date:'2026-09-04T00:00:00Z',close:100,adjClose:95,splitFactor:1,divCash:0}]));}});
 assert.equal((await api.eod('SPY','2026-09-04','2026-09-05'))[0].adjusted_close,95);
 await assert.rejects(()=>makeTiingo({token:'TEST',fetchImpl:()=>{throw Error('called')}}).eod('SPY','2026-09-04','2026-09-05'),/licensing/);assert.equal(calls,1);
});
test('SEC point-in-time facts exclude later restatements and undated accessions',()=>{
 const cf={facts:{'us-gaap':{Revenue:{units:{USD:[{accn:'old',val:100},{accn:'new',val:150},{accn:'undated',val:200}]}}}}};
 const subs={filings:{recent:{accessionNumber:['old','new','undated'],acceptanceDateTime:['2026-08-01T12:00:00Z','2026-10-01T12:00:00Z',null]}}};
 const result=factsKnownAt(cf,subs,'2026-09-05T00:00:00Z');assert.deepEqual(result.facts.map(f=>f.value),[100]);
});
test('ROI excludes shadow, refuses unmatched/missing costs and removes best outcome',()=>{
 const rows=[1,2].map(i=>({id:String(i),cohort:'paper',capital:1000,gross_pnl:i*100,benchmark_pnl:50,cash_pnl:1,fees:2,slippage:3,receipt_id:'TEST:'+i,baseline_exposure_matched:true,matured_at:'2026-09-04T21:00:00Z',entry_at:'2026-09-01T15:00:00Z',exit_at:'2026-09-04T20:00:00Z'}));
 const opts={periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-09-05T00:00:00Z',fixedCosts:99};
 const r=evaluateOpportunities([...rows,{id:'shadow',cohort:'shadow'}],opts);assert.equal(r.net_active_result,191);assert.equal(r.benchmark_excess,91);assert.equal(r.best_opportunity_removed,-54);assert.equal(r.shadow_count,1);
 assert.equal(evaluateOpportunities(rows,{...opts,fixedCosts:null}).net_active_result,null);
 assert.equal(evaluateOpportunities([{...rows[0],baseline_exposure_matched:false}],opts).net_active_result,null);
 assert.equal(markedDrawdown([{at:'2026-09-01',equity:100,external_flow:0},{at:'2026-09-02',equity:80,external_flow:0}]),.2);
});
