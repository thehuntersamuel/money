import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create function public.is_owner() returns boolean language sql as $$ select false $$;
create table paper_books(id uuid primary key, label text);
create table trades(id uuid primary key default gen_random_uuid(), book_id uuid references paper_books,
 symbol text, status text default 'open', is_real boolean default false, direction text default 'long',
 qty numeric, entry_price numeric, target_price numeric, stop_price numeric, exit_price numeric,
 close_note text, closed_on date, opened_on date default current_date, updated_at timestamptz default now(),
 planned_loss numeric, horizon text, setup text, confidence integer, stated_upside_pct numeric,
 stated_downside_pct numeric, max_book_risk_pct numeric, review_on date, thesis text, catalyst text,
 invalidation text, evidence text);
create view v_paper_books as select id book_id, label, 10000::numeric equity,10000::numeric buying_power from paper_books;
`);
await db.exec(readFileSync(new URL('../supabase/migrations/20260830000000_morrow_trade_proposals.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260830020000_morrow_trade_close_lifecycle.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260905013412_morrow_durable_events_and_guards.sql',import.meta.url),'utf8'));
const book='10000000-0000-0000-0000-000000000001', other='10000000-0000-0000-0000-000000000002';
await db.query("insert into paper_books values ($1,'Robinhood Savings'),($2,'Retirement')",[book,other]);
async function fixture({linked=true,real=false,wrongBook=false,symbol='SPY'}={}) {
 await db.exec('alter table trades disable trigger morrow_trade_guard');
 const {rows:[t]}=await db.query('insert into trades(book_id,symbol,is_real,qty,entry_price) values($1,$2,$3,1,100) returning id',[book,'SPY',real]);
 await db.exec('alter table trades enable trigger morrow_trade_guard');
 if(linked) await db.query(`insert into trade_proposals(book_id,proposal_key,symbol,asset_name,asset_type,state,direction,setup,horizon,benchmark,observed_at,observed_price,entry_price,target_price,stop_price,entry_condition,review_on,thesis,bull_case,bear_case,catalyst,invalidation,source_freshness,news_checked_at,confidence,decision,source_evidence_hash,last_researched_at,trade_id)
 values($1,$2,$3,'TEST','etf','opened','long','swing','short','SPY',now(),100,100,110,95,'TEST',current_date,'TEST','TEST','TEST','TEST','TEST','fresh',now(),50,'paper_executed',repeat('a',64),now(),$4)`,[wrongBook?other:book,t.id,symbol,t.id]);
 return t.id;
}
const close=(id,price=102,note='TEST close',b=book)=>db.query('select * from close_morrow_paper_trade($1,$2,$3,$4)',[b,id,price,note]);
async function rejectedUnchanged(id, pattern, fn=()=>close(id)) {
 await assert.rejects(fn,pattern);
 assert.equal((await db.query('select status from trades where id=$1',[id])).rows[0].status,'open');
 assert.equal((await db.query('select count(*)::int n from morrow_close_receipts where trade_id=$1',[id])).rows[0].n,0);
}
await test('supplied close patch reproduces ambiguous SQL and rolls back unchanged',async()=>{
 const id=await fixture();
 await db.exec('begin');
 await db.exec(readFileSync(new URL('./fixtures/supplied_close.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>close(id),/ambiguous/);
 await db.exec('rollback');
 assert.equal((await db.query('select status from trades where id=$1',[id])).rows[0].status,'open');
});
await test('atomic linked close, exact retry and immutable receipt',async()=>{
 const id=await fixture(); const first=(await close(id)).rows[0];
 assert.equal(first.proposal_state,'closed'); assert.equal(first.proposal_decision,'closed');
 assert.deepEqual((await close(id)).rows[0],first);
 await assert.rejects(()=>close(id,103),/conflicting close/);
 await assert.rejects(()=>db.query('update morrow_close_receipts set receipt=\'{}\' where trade_id=$1',[id]),/immutable/);
});
await test('legacy manual paper close remains supported',async()=>{const id=await fixture({linked:false});assert.equal((await close(id)).rows[0].proposal_id,null);});
await test('real, wrong-book and symbol mismatches fail without partial mutation',async()=>{
 await rejectedUnchanged(await fixture({real:true}),/open paper trade not found/);
 await rejectedUnchanged(await fixture({wrongBook:true}),/book does not match/);
 await rejectedUnchanged(await fixture({symbol:'QQQ'}),/symbol does not match/);
 const id=await fixture();await rejectedUnchanged(id,/book unavailable/,()=>close(id,102,'TEST',other));
});
await test('receipt insertion failure rolls back trade AND proposal',async()=>{
 const id=await fixture();
 await db.exec(`create function fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'TEST receipt failure'; end $$;
 create trigger fail_receipt before insert on morrow_close_receipts for each row execute function fail_receipt();`);
 await rejectedUnchanged(id,/TEST receipt failure/);
 assert.equal((await db.query('select state from trade_proposals where trade_id=$1',[id])).rows[0].state,'opened');
 await db.exec('drop trigger fail_receipt on morrow_close_receipts');
});
await test('unauthorized roles cannot close or read private receipts',async()=>{
 const id=await fixture();
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>close(id),/permission denied/);
  if(role==='authenticated') assert.equal((await db.query('select * from morrow_close_receipts')).rows.length,0);
  else await assert.rejects(()=>db.query('select * from morrow_close_receipts'),/permission denied/);
  await db.exec('reset role');
 }
});
await test('numeric nonfinite values and blank notes are rejected',async()=>{
 const id=await fixture();
 for(const value of ['NaN','Infinity',0,-1]) await rejectedUnchanged(id,/positive/,()=>close(id,value));
 await rejectedUnchanged(id,/note/,()=>close(id,102,' '));
});
await test('durable TEST crossing persists after receding price and duplicates do not multiply',async()=>{
 const id=await fixture();
 await db.query("update trade_proposals set state='watch',decision='wait_for_trigger',trade_id=null,trigger_direction='above',trigger_price=101,last_researched_at=now()-interval '1 hour' where trade_id=$1",[id]);
 const insert = (source,price) => db.query("insert into morrow_market_observations(source_id,symbol,provider,feed,event_at,session,last,gap,is_test) values($1,'SPY','alpaca','sip',now(),'regular',$2,false,false)",[source,price]);
 await insert('TEST-crossing',102); await insert('TEST-receding',100);
 assert.equal((await db.query('select count(*)::int n from morrow_trigger_events')).rows[0].n,1);
 await insert('TEST-crossing-again',103);
 assert.equal((await db.query('select count(*)::int n from morrow_trigger_events')).rows[0].n,1);
 await assert.rejects(()=>insert('TEST-crossing',102),/unique/);
});
await test('new Savings openings fail closed in the database',async()=>{
 await assert.rejects(()=>db.query("insert into trades(book_id,symbol,status) values($1,'SPY','open')",[book]),/openings blocked/);
});
await test('rollback refuses to disable exits with existing paper exposure',async()=>{
 await assert.rejects(()=>db.exec(readFileSync(new URL('../supabase/rollbacks/20260830020000_morrow_trade_close_lifecycle.rollback.sql',import.meta.url),'utf8')),/paper exposure remains/);
 await db.exec('rollback');
});
await db.close();
