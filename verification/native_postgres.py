#!/usr/bin/env python3
"""Native separate-session SQL rehearsal; synthetic local CI database ONLY."""
import concurrent.futures
import os
import re
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
if os.environ.get('PGHOST') not in {'localhost','127.0.0.1'} or os.environ.get('PGDATABASE')!='morrow_ci_test':
 raise SystemExit('Refusing: dedicated localhost morrow_ci_test database required')

def sql(statement,ok=True):
 p=subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-A','-t','-c',statement],text=True,capture_output=True,timeout=30)
 if ok and p.returncode: raise AssertionError(p.stderr)
 if not ok and not p.returncode: raise AssertionError('Expected SQL rejection')
 return p.stdout.strip() if ok else p.stderr

# The same minimized fixture as the PostgreSQL-engine tests. This proves native
# concurrency, not compatibility with every production schema/grant dependency.
source=(ROOT/'tests/close_postgres.test.mjs').read_text()
base=re.search(r'await db.exec\(`([\s\S]*?)`\);',source).group(1)
sql(base)
for path in sorted((ROOT/'supabase/migrations').glob('*.sql')): sql(path.read_text())
BOOK='10000000-0000-0000-0000-000000000001'
sql(f"insert into paper_books values('{BOOK}','Robinhood Savings')")

def fixture(n):
 tid=f'20000000-0000-0000-0000-{n:012d}'
 sql(f"""alter table trades disable trigger morrow_trade_guard;
 insert into trades(id,book_id,symbol,qty,entry_price) values('{tid}','{BOOK}','SPY',1,100);
 alter table trades enable trigger morrow_trade_guard;
 insert into trade_proposals(book_id,proposal_key,symbol,asset_name,asset_type,state,direction,setup,horizon,benchmark,observed_at,observed_price,entry_price,target_price,stop_price,entry_condition,review_on,thesis,bull_case,bear_case,catalyst,invalidation,source_freshness,news_checked_at,confidence,decision,source_evidence_hash,last_researched_at,trade_id)
 values('{BOOK}','TEST:{n}','SPY','TEST','etf','opened','long','swing','short','SPY',now(),100,100,110,95,'TEST',current_date,'TEST','TEST','TEST','TEST','TEST','fresh',now(),50,'paper_executed',repeat('a',64),now(),'{tid}');""")
 return tid

def close(tid,price=102):
 return f"select row_to_json(r)::text from close_morrow_paper_trade('{BOOK}','{tid}',{price},'TEST close') r"

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 tid=fixture(1)
 values=list(pool.map(lambda _:sql(close(tid)),range(3)))
 assert len(set(values))==1,values
 assert sql(f"select count(*) from morrow_close_receipts where trade_id='{tid}'")=='1'
 print('PASS native concurrent identical closes: one canonical receipt')
 tid=fixture(2)
 def attempt(price):
  try:return ('ok',sql(close(tid,price)))
  except AssertionError:return ('rejected',None)
 results=list(pool.map(attempt,[102,103]))
 assert sorted(x[0] for x in results)==['ok','rejected'],results
 print('PASS native concurrent conflicting closes: one success, one conflict')
 tid=fixture(3)
 # Hold the proposal lock in session A while the close starts in session B.
 # advisory lock gives a deterministic barrier without changing tested function SQL.
 lock_id=873201
 def edit_proposal():
  return sql(f"begin; select pg_advisory_lock({lock_id}); select id from trade_proposals where trade_id='{tid}' for update; select pg_sleep(1); update trade_proposals set thesis='TEST concurrent revision' where trade_id='{tid}'; commit; select pg_advisory_unlock({lock_id});")
 edit=pool.submit(edit_proposal)
 import time
 deadline=time.monotonic()+10
 while sql(f"select count(*) from pg_locks where locktype='advisory' and objid={lock_id}")=='0':
  if time.monotonic()>deadline: raise AssertionError('proposal lock barrier timeout')
  time.sleep(.05)
 closed=pool.submit(sql,close(tid))
 edit.result();closed.result()
 assert sql(f"select state||':'||decision from trade_proposals where trade_id='{tid}'")=='closed:closed'
 print('PASS native proposal-edit / close ordering reconciles atomically')
 tid=fixture(4)
 opened=pool.submit(sql,f"insert into trades(book_id,symbol,qty,entry_price) values('{BOOK}','SPY',1,100)",False)
 closed=pool.submit(sql,close(tid));assert 'openings blocked' in opened.result();closed.result()
 print('PASS native opening guard / close: opening blocked, exit succeeds')
print('Native multi-session fixture rehearsal passed. Exact live-schema rehearsal and independent review remain separate gates.')
