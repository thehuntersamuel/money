#!/usr/bin/env python3
"""Local append-only Morrow sidecars. No provider calls or trading operations."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path.home() / 'Projects/Hunter/maddox-command/capital/morrow'
KINDS = {'source', 'decision', 'strategy', 'outcome', 'run', 'audit'}
FIELDS = {
 'source': {'url','title','source_type','released_at','retrieved_at','accession','vintage','content_sha256','retention_note'},
 'decision': {'proposal_key','symbol','disposition','horizon','thesis','bear_case','catalyst','review_at','strategy_id','source_ids','event_ids','assumptions','missing_data','benchmark','sync_receipt_id'},
 'strategy': {'name','hypothesis','universe','horizon','entry_rules','exit_rules','cost_assumptions','baseline','holdout','variants_tried','promotion_criteria'},
 'outcome': {'decision_id','cohort','matured_at','gross_return','benchmark_return','cash_return','transaction_cost','fixed_cost','missing_reason','receipt_ids'},
 'run': {'job_id','started_at','finished_at','status','actual_provider','actual_model','actual_reasoning_effort','runtime_evidence_id','input_ids','output_ids','blockers'},
 'audit': {'subject','status','evidence_ids','blockers','note'},
}

def now():
 return datetime.now(timezone.utc).isoformat()

def canonical(value):
 return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)

def timestamp(value):
 if not isinstance(value,str): raise ValueError('timestamp required')
 try: d=datetime.fromisoformat(value.replace('Z','+00:00'))
 except ValueError: raise ValueError('invalid timestamp') from None
 if d.tzinfo is None: raise ValueError('timestamp needs timezone')
 return d

def validate(kind, data):
 if kind not in KINDS or not isinstance(data,dict): raise ValueError('invalid record kind or payload')
 if set(data)-FIELDS[kind]: raise ValueError('unknown fields; secrets and raw provider payloads are not accepted')
 if len(canonical(data).encode())>32768: raise ValueError('record exceeds 32 KiB')
 def require(*keys):
  if any(data.get(k) in (None,'',[]) for k in keys): raise ValueError('missing required fields: '+', '.join(keys))
 for key,value in data.items():
  if key.endswith('_at') and value is not None: timestamp(value)
  if key.endswith('_ids') and (not isinstance(value,list) or len(value)>100 or any(not isinstance(v,str) or len(v)>200 for v in value)):
   raise ValueError('invalid reference list')
 if kind=='source':
  require('url','title','source_type','retrieved_at','retention_note')
  url=urlsplit(data['url'])
  if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment: raise ValueError('use a public HTTPS source URL without credentials/query/fragment')
  if data['source_type'] not in {'sec','issuer','regulator','macro','news_discovery','other_public'}: raise ValueError('invalid source type')
  if data.get('content_sha256') and not re.fullmatch('[0-9a-f]{64}',data['content_sha256']): raise ValueError('invalid content hash')
 if kind=='decision':
  require('proposal_key','symbol','disposition','horizon','thesis','bear_case','benchmark')
  if not isinstance(data.get('missing_data'),list): raise ValueError('missing_data must explicitly be a list')
  if not re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,9}',data['symbol']): raise ValueError('invalid symbol')
  if data['disposition'] not in {'watch','rejected','research_qualified','shadow'}: raise ValueError('local decisions cannot open trades')
  if data['horizon'] not in {'swing','position'}: raise ValueError('separate swing and position cohorts')
  if data['disposition']=='research_qualified' and len(set(data.get('source_ids',[])))<2: raise ValueError('qualification needs two source references')
 if kind=='strategy':
  require('name','hypothesis','universe','horizon','entry_rules','exit_rules','cost_assumptions','baseline','holdout','variants_tried','promotion_criteria')
  if not isinstance(data['universe'],list) or not 1<=len(data['universe'])<=30: raise ValueError('universe must contain 1-30 symbols')
 if kind=='outcome':
  require('decision_id','cohort')
  if data['cohort'] not in {'shadow','rejected','paper'}: raise ValueError('invalid outcome cohort')
  if data['cohort']=='paper' and not data.get('receipt_ids'): raise ValueError('paper outcomes require canonical receipt references')
  for key in ('gross_return','benchmark_return','cash_return','transaction_cost','fixed_cost'):
   value=data.get(key)
   if value is not None and (isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value)): raise ValueError('numeric outcomes must be finite or null')
  if any(data.get(k) is None for k in ('gross_return','benchmark_return','cash_return','transaction_cost','fixed_cost')) and not data.get('missing_reason'): raise ValueError('unknown outcomes need a reason')
 if kind=='run':
  require('job_id','started_at','finished_at','status')
  if data['status'] not in {'ok','blocked','failed','no_change'}: raise ValueError('invalid run status')
  if timestamp(data['finished_at'])<timestamp(data['started_at']): raise ValueError('run finishes before it starts')
 if kind=='audit': require('subject','status')
 return data

def connect(root):
 root=Path(root)
 root.mkdir(parents=True,exist_ok=True,mode=0o700)
 path=root/'research-ledger.sqlite3'
 if path.is_symlink(): raise ValueError('ledger cannot be a symlink')
 fd=os.open(path,os.O_CREAT|os.O_WRONLY,0o600);os.close(fd)
 os.chmod(path,0o600)
 db=sqlite3.connect(path,timeout=10)
 db.execute('PRAGMA foreign_keys=ON')
 db.executescript('''
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,idempotency_key TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'append-only ledger'); END;
 CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'append-only ledger'); END;
 ''')
 return db

def append(root,kind,key,data):
 validate(kind,data)
 if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9_.:\-]{1,160}',key): raise ValueError('invalid idempotency key')
 payload=canonical(data);digest=hashlib.sha256((kind+'\n'+payload).encode()).hexdigest()
 record_id=hashlib.sha256((key+'\n'+digest).encode()).hexdigest()
 db=connect(root)
 try:
  with db:
   db.execute('BEGIN IMMEDIATE')
   old=db.execute('SELECT id,kind,payload FROM records WHERE idempotency_key=?',(key,)).fetchone()
   if old:
    if old[1:]!=(kind,payload): raise ValueError('idempotency conflict; append a new revision')
    return {'id':old[0],'replayed':True,'hub_synced':False}
   refs=[]
   if kind=='decision': refs=[(x,'source') for x in data.get('source_ids',[])]+([(data['strategy_id'],'strategy')] if data.get('strategy_id') else [])
   if kind=='outcome': refs=[(data['decision_id'],'decision')]
   for ref,expected in refs:
    if db.execute('SELECT kind FROM records WHERE id=?',(ref,)).fetchone()!=(expected,): raise ValueError('missing local '+expected+' reference')
   if kind=='decision' and data['disposition']=='research_qualified':
    for ref in data['source_ids']:
     src=json.loads(db.execute('SELECT payload FROM records WHERE id=?',(ref,)).fetchone()[0])
     if src['source_type'] not in {'sec','issuer','regulator','macro'}: raise ValueError('qualification needs primary sources')
   db.execute('INSERT INTO records VALUES(?,?,?,?,?,?)',(record_id,kind,key,now(),payload,digest))
  return {'id':record_id,'replayed':False,'hub_synced':False}
 finally: db.close()

def snapshot(root):
 db=connect(root)
 try:
  counts=dict(db.execute('SELECT kind,COUNT(*) FROM records GROUP BY kind'))
  return {'mode':'exploratory_research','new_openings_allowed':False,'real_trading_allowed':False,
   'champion':None,'evaluation_started_at':None,'providers':{'alpaca':'disabled_pending_owner','tiingo':'disabled_pending_owner'},
   'local_record_counts':counts,'hub_sync':'sidecars_only','actual_route':'unknown_until_runtime_evidence_review',
   'blockers':['backend_deployment_unverified','provider_entitlement_unverified','calendar_unknown','champion_not_activated','native_concurrency_review_pending']}
 finally: db.close()

def export(root):
 db=connect(root)
 try:
  for row in db.execute('SELECT id,kind,idempotency_key,created_at,payload,sha256 FROM records ORDER BY rowid'):
   yield dict(zip(('id','kind','idempotency_key','created_at','payload','local_sha256'),(*row[:4],json.loads(row[4]),row[5])))
 finally: db.close()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=ROOT)
 sub=p.add_subparsers(dest='command',required=True)
 sub.add_parser('status');sub.add_parser('export')
 record=sub.add_parser('record');record.add_argument('kind',choices=sorted(KINDS));record.add_argument('--key',required=True);record.add_argument('--payload',type=Path,required=True)
 a=p.parse_args()
 try:
  if a.command=='status': print(canonical(snapshot(a.root)))
  elif a.command=='export':
   for row in export(a.root): print(canonical(row))
  else: print(canonical(append(a.root,a.kind,a.key,json.loads(a.payload.read_text()))))
  return 0
 except (ValueError,TypeError,KeyError,OSError,sqlite3.Error):
  print(canonical({'ok':False,'error':'local_record_failed_validation_or_storage','details':'inspect locally; payload omitted'}));return 1

if __name__=='__main__': raise SystemExit(main())
