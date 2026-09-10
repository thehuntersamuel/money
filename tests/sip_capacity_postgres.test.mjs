import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
test('additive capacity migration preserves private immutable research and health view contract',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table morrow_integration_health(id uuid default gen_random_uuid(),dataset text,checked_at timestamptz,status text,detail text,coverage text);
 alter table morrow_integration_health enable row level security;
 create view morrow_latest_integration_health with(security_invoker=true) as select distinct on(dataset) dataset,checked_at,status,detail,coverage from morrow_integration_health order by dataset,checked_at desc,id desc;
 create table trade_proposals(symbol text,last_researched_at timestamptz,state text,decision text);
 create table morrow_market_observations(source_id text);
 insert into morrow_market_observations values('TEST-legacy');
 create function morrow_receipt_immutable() returns trigger language plpgsql as $$begin raise exception 'immutable';end;$$;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260910042000_morrow_sip_capacity.sql',import.meta.url),'utf8'));
 const columns=(await db.query("select column_name from information_schema.columns where table_name='morrow_latest_integration_health' order by ordinal_position")).rows.map(r=>r.column_name);
 assert.deepEqual(columns,['dataset','checked_at','status','detail','coverage','metrics']);
 assert.equal((await db.query("select persisted_at from morrow_market_observations where source_id='TEST-legacy'")).rows[0].persisted_at,null);
 await db.exec("insert into morrow_market_observations(source_id) values('TEST-new')");
 assert((await db.query("select persisted_at from morrow_market_observations where source_id='TEST-new'")).rows[0].persisted_at);
 await db.exec("insert into morrow_research_minute_bars(source_id,symbol,provider,feed,event_at,kind,session,open,high,low,close,volume) values('TEST','SPY','alpaca','sip',now(),'b','regular',100,101,99,100,10)");
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select * from morrow_research_minute_bars'),/permission denied/);await db.exec('reset role');}
 await assert.rejects(()=>db.exec("update morrow_research_minute_bars set close=101"),/immutable/);
 const triggers=(await db.query("select tgname from pg_trigger where tgrelid='morrow_research_minute_bars'::regclass and not tgisinternal")).rows;
 assert.deepEqual(triggers.map(r=>r.tgname),['immutable_research_bar']);
 }finally{await db.close();}
});
