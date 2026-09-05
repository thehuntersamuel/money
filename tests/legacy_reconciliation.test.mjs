import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const db=new PGlite();
await db.exec(readFileSync('tests/fixtures/live_scoped_schema.sql','utf8'));
for(const f of readdirSync('supabase/migrations').sort())if(f.endsWith('.sql')&&!f.startsWith('20260830000000'))await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const repair=readFileSync('supabase/repairs/reconcile_legacy_closes.sql','utf8');
const book='10000000-0000-0000-0000-000000000001';
await db.exec(`insert into accounts values('${book}');insert into paper_books(id,account_id,label) values('${book}','${book}','Robinhood Savings');`);
async function fixture(n){
 const tid=`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 await db.exec(`insert into trades(id,book_id,symbol,qty,entry_price,status,exit_price,closed_on,close_note) values('${tid}','${book}','SPY',1,100,'closed',102,current_date,'TEST historical close');
 insert into trade_proposals(book_id,proposal_key,symbol,asset_name,asset_type,state,direction,setup,horizon,benchmark,observed_at,observed_price,entry_price,target_price,stop_price,entry_condition,review_on,thesis,bull_case,bear_case,catalyst,invalidation,source_freshness,news_checked_at,confidence,decision,source_evidence_hash,last_researched_at,trade_id)
 values('${book}','TEST:legacy:${n}','SPY','TEST','etf','opened','long','swing','short','SPY',now(),100,100,110,95,'TEST',current_date,'TEST','TEST','TEST','TEST','TEST','fresh',now(),50,'paper_executed',repeat('a',64),now(),'${tid}');`);
 return tid;
}
await test('legacy reconciliation preserves trade and thesis, audits once, never fabricates execution receipt',async()=>{
 const id=await fixture(1);
 const before=(await db.query('select * from trades where id=$1',[id])).rows[0];
 const version=(await db.query('select thesis_version from trade_proposals where trade_id=$1',[id])).rows[0].thesis_version;
 await db.exec(repair);await db.exec(repair);
 assert.deepEqual((await db.query('select * from trades where id=$1',[id])).rows[0],before);
 assert.deepEqual((await db.query('select state,decision,thesis_version from trade_proposals where trade_id=$1',[id])).rows[0],{state:'closed',decision:'closed',thesis_version:version});
 const {rows}=await db.query('select payload,server_sha256 from morrow_research_records');
 assert.equal(rows.length,1);assert.equal(rows[0].payload.status,'reconciled_without_execution_receipt');assert.match(rows[0].server_sha256,/^[a-f0-9]{64}$/);
 assert.equal((await db.query('select count(*)::int n from morrow_close_receipts')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from morrow_proposal_history where proposal_id=(select id from trade_proposals where trade_id=$1)',[id])).rows[0].n,3);
});
await test('audit failure atomically rolls back legacy proposal reconciliation',async()=>{
 const id=await fixture(2);
 await db.exec("create function fail_legacy_audit() returns trigger language plpgsql as $$ begin raise exception 'TEST audit failure'; end $$;create trigger fail_legacy_audit before insert on morrow_research_records for each row execute function fail_legacy_audit();");
 await assert.rejects(()=>db.exec(repair),/TEST audit failure/);await db.exec('rollback');
 assert.equal((await db.query('select state from trade_proposals where trade_id=$1',[id])).rows[0].state,'opened');
 await db.exec('drop trigger fail_legacy_audit on morrow_research_records');
});
await test('mismatched legacy identity rejects without partial repair',async()=>{
 const id=await fixture(3);
 await db.exec(`update trade_proposals set symbol='QQQ',thesis_version=thesis_version+1,last_researched_at=clock_timestamp() where trade_id='${id}'`);
 await assert.rejects(()=>db.exec(repair),/identity mismatch/);await db.exec('rollback');
 assert.equal((await db.query('select state from trade_proposals where trade_id=$1',[id])).rows[0].state,'opened');
 assert.equal((await db.query('select state from trade_proposals where proposal_key=$1',['TEST:legacy:2'])).rows[0].state,'opened');
});
await db.close();
