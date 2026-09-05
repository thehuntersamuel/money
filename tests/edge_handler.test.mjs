import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as research from '../supabase/functions/morrow-bridge/research.mjs';
import * as contract from '../supabase/functions/morrow-bridge/contract.mjs';
const key='TEST-ONLY-KEY-'.repeat(4);
const keyHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))).toString('hex');
const raw=readFileSync(new URL('../supabase/functions/morrow-bridge/index.ts',import.meta.url),'utf8')
 .replace(/import \{ createClient \}[^;]+;/,'').replace(/import \{[\s\S]*?\} from '\.\/contract.mjs';/,'')
 .replace(/import \{ validateResearch, researchSummary \} from '\.\/research.mjs';/,'')
 .replace(/const EXPECTED_KEY_SHA256 = '[a-f0-9]+';/,`const EXPECTED_KEY_SHA256 = '${keyHash}';`);
function harness({rows={},approved=false}={}){
 let handler;let clients=0;let mutations=0;const tables=[];
 const book={book_id:'TEST-book',label:'Robinhood Savings',equity:10000,buying_power:10000};
 const db={from(table){tables.push(table);const q={then(resolve){return Promise.resolve({data:table==='v_paper_books'?[book]:(rows[table]||[]),error:null}).then(resolve)}};for(const method of ['select','eq','limit','order','in'])q[method]=()=>q;return q;},rpc(){mutations++;throw new Error('unexpected mutation')}};
 const context={...contract,...research,Response,Request,URL,TextEncoder,crypto,Date,Intl,createClient(){clients++;return db;},Deno:{env:{get:name=>approved&&/_(LICENSE|DISPLAY)_APPROVED$/.test(name)?'true':'TEST-only'},serve(fn){handler=fn;}}};
 vm.runInNewContext(stripTypeScriptTypes(raw),context);
 return {call:(operation,{authenticated=true,method='POST',payload={}}={})=>handler(new Request('https://example.test',{method,headers:authenticated?{authorization:`Bearer ${key}`}:{},...(method==='POST'?{body:JSON.stringify({operation,...payload})}:{})})),tables:()=>tables,counts:()=>({clients,mutations})};
}
test('unauthorized/method failures perform no database operations',async()=>{
 const h=harness();assert.equal((await h.call('state',{authenticated:false})).status,401);assert.equal((await h.call('state',{method:'GET'})).status,405);assert.deepEqual(h.counts(),{clients:0,mutations:0});
});
test('new openings fail closed before any mutation',async()=>{
 const h=harness();const r=await h.call('place_trade');assert.equal(r.status,409);assert.match((await r.json()).error,/blocked/);assert.equal(h.counts().mutations,0);
});
test('state reads are bounded and mutation-free',async()=>{
 const h=harness();const r=await h.call('state');assert.equal(r.status,200);assert.equal((await r.json()).mutation_calls,0);assert.equal(h.counts().mutations,0);
});

test('paid data read rejects unsupported datasets before storage access',async()=>{
 const h=harness();const r=await h.call('data_read');assert.equal(r.status,400);assert.equal(h.counts().mutations,0);
});

test('revoked paid display permission hides previously stored snapshots',async()=>{
 const h=harness();const r=await h.call('data_read',{payload:{dataset:'alpaca_sip'}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.reason,'current_provider_use_not_approved');assert.deepEqual(h.tables(),['v_paper_books']);assert.equal(h.counts().mutations,0);
});

test('continuous SIP observations are readable without a snapshot',async()=>{
 const h=harness({approved:true,rows:{morrow_market_observations:[{source_id:'TEST-observation',event_at:'2026-09-04T15:00:00Z'}]}});
 const response=await h.call('data_read',{payload:{dataset:'alpaca_sip'}}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.snapshot,null);assert.equal(body.observations.length,1);
 assert.equal(body.status,'observations_available_check_timestamp');
});
test('active proposal overflow fails explicitly instead of returning partial coverage',async()=>{
 const h=harness({rows:{trade_proposals:Array.from({length:501},(_,i)=>({id:String(i)}))}});
 assert.notEqual((await h.call('state')).status,200);
});
