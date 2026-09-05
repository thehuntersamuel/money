#!/usr/bin/env python3
"""Stage/install reversible Morrow scripts. Never changes cron, credentials or services."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO=Path(__file__).resolve().parents[1]
SCRIPTS=('morrow_finance_bridge.py','morrow_proposal_trigger.py','morrow_runtime.py','morrow_mac_doctor.py')

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def safe(path):
 path=Path(path).absolute()
 for item in (path,*path.parents):
  if item.is_symlink(): raise ValueError('symlink in installation path')
 return path

def write_atomic(path,content,mode):
 path=safe(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.morrow-')
 try:
  with os.fdopen(fd,'wb') as f: f.write(content);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp): os.unlink(tmp)

def plan(hermes,project):
 hermes=safe(hermes);project=safe(project)
 if not hermes.is_dir() or not project.is_dir(): raise ValueError('existing Hermes home and maddox-command project required')
 items=[]
 for name in SCRIPTS:
  source=REPO/'scripts'/name;target=safe(hermes/'scripts'/name)
  items.append({'source':str(source),'target':str(target),'sha256':sha(source),'before_sha256':sha(target) if target.exists() else None})
 for name in ('OPERATING_CONTRACT.md','scheduler-baseline.json','MORROW_MAC_HANDOFF.md','JOB_AMENDMENTS.md','FULL_MARKET_RESEARCH.md'):
  source=REPO/'mac'/name;target=safe(project/'capital/morrow/setup'/name)
  items.append({'source':str(source),'target':str(target),'sha256':sha(source),'before_sha256':sha(target) if target.exists() else None})
 return items

def install(hermes,project):
 items=plan(hermes,project)
 backup=safe(project/'capital/morrow/setup-backups'/str(uuid.uuid4()))
 backup.mkdir(parents=True,mode=0o700)
 manifest={'created_at':datetime.now(timezone.utc).isoformat(),'hermes':str(hermes.absolute()),'project':str(project.absolute()),'entries':items,'state':'prepared'}
 for i,item in enumerate(items):
  target=Path(item['target'])
  if item['before_sha256']:
   item['backup']=str(backup/f'{i}.before');item['before_mode']=target.stat().st_mode&0o777
   shutil.copyfile(target,item['backup']);os.chmod(item['backup'],0o600)
 write_atomic(backup/'manifest.json',(json.dumps(manifest,indent=2)+'\n').encode(),0o600)
 installed=[]
 try:
  for item in items:
   target=Path(item['target'])
   if (sha(target) if target.exists() else None)!=item['before_sha256']: raise ValueError('destination changed during install')
   source=Path(item['source'])
   if sha(source)!=item['sha256']: raise ValueError('source changed during install')
   write_atomic(target,source.read_bytes(),0o700 if target.suffix=='.py' else 0o600);installed.append(item)
  manifest['state']='installed'
 except Exception:
  # Restore only files this invocation changed, preserving evidence and all sidecars.
  for item in reversed(installed):
   target=Path(item['target'])
   if sha(target)!=item['sha256']: continue
   if item.get('backup'): write_atomic(target,Path(item['backup']).read_bytes(),item['before_mode'])
   else: target.unlink()
  manifest['state']='failed_restored'
  write_atomic(backup/'manifest.json',(json.dumps(manifest,indent=2)+'\n').encode(),0o600)
  raise
 write_atomic(backup/'manifest.json',(json.dumps(manifest,indent=2)+'\n').encode(),0o600)
 return {'installed':True,'manifest':str(backup/'manifest.json'),'scheduler_changed':False,'providers_enabled':False,'new_openings_allowed':False}

def rollback(manifest_path):
 manifest_path=safe(manifest_path)
 m=json.loads(manifest_path.read_text())
 if m.get('state')!='installed': raise ValueError('only an installed manifest can be rolled back')
 hermes=safe(m['hermes']);project=safe(m['project'])
 allowed={str(hermes/'scripts'/name) for name in SCRIPTS}|{str(project/'capital/morrow/setup'/name) for name in ('OPERATING_CONTRACT.md','scheduler-baseline.json','MORROW_MAC_HANDOFF.md','JOB_AMENDMENTS.md','FULL_MARKET_RESEARCH.md')}
 if len(m['entries'])!=len(allowed) or {i['target'] for i in m['entries']}!=allowed: raise ValueError('invalid manifest targets')
 for item in m['entries']:
  target=safe(item['target'])
  if not target.is_file() or sha(target)!=item['sha256']: raise ValueError('installed file changed; review before rollback')
  if item.get('backup'):
   backup=safe(item['backup'])
   if backup.parent!=manifest_path.parent or sha(backup)!=item['before_sha256']: raise ValueError('invalid backup')
 for item in reversed(m['entries']):
  target=Path(item['target'])
  if item.get('backup'): write_atomic(target,Path(item['backup']).read_bytes(),item['before_mode'])
  else: target.unlink()
 m['state']='rolled_back';write_atomic(manifest_path,(json.dumps(m,indent=2)+'\n').encode(),0o600)
 return {'rolled_back':True,'ledger_preserved':True,'scheduler_changed':False}

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('command',choices=['plan','install','rollback'])
 p.add_argument('--hermes-home',type=Path,default=Path.home()/'.hermes')
 p.add_argument('--project',type=Path,default=Path.home()/'Projects/Hunter/maddox-command')
 p.add_argument('--manifest',type=Path)
 a=p.parse_args()
 try:
  if sys.version_info<(3,9): raise ValueError('Python 3.9 or newer required')
  if a.command!='plan' and platform.system()!='Darwin': raise ValueError('installation and rollback require the Mac; use plan here')
  if a.command=='plan': result={'files':plan(a.hermes_home,a.project),'scheduler_changed':False,'providers_enabled':False}
  elif a.command=='install': result=install(a.hermes_home,a.project)
  else:
   if not a.manifest: raise ValueError('--manifest required')
   result=rollback(a.manifest)
  print(json.dumps(result,indent=2));return 0
 except (OSError,ValueError) as exc:
  print(json.dumps({'ok':False,'error':str(exc)}));return 1

if __name__=='__main__': raise SystemExit(main())
