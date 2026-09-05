#!/usr/bin/env python3
"""Read-only Mac installation/cron audit. Never reads secret contents or invokes jobs."""
from __future__ import annotations
import argparse
import json
import os
import platform
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_IDS={'0a1797b7e2e2','d4a3fe8b1946','51e4decec41b','4718bc248f30','36e97d7dbfe1','2f8a80689531','87e2acc68f2c'}

def audit_jobs(raw,baseline):
 jobs=raw.get('jobs') if isinstance(raw,dict) else raw
 if not isinstance(jobs,list) or any(not isinstance(j,dict) for j in jobs): return {'ok':False,'blockers':['unsupported_scheduler_schema'],'jobs':[]}
 expected={j['id']:j for j in baseline['jobs']}
 if set(expected)!=EXPECTED_IDS: return {'ok':False,'blockers':['baseline_identity_mismatch'],'jobs':[]}
 blockers=[];reports=[]
 for jid,wanted in expected.items():
  matches=[j for j in jobs if j.get('id')==jid]
  if len(matches)!=1: blockers.append(jid+':missing_or_duplicate');continue
  actual=matches[0];issues=[]
  for field in ('enabled','model','provider','reasoning_effort','no_agent','deliver'):
   if actual.get(field)!=wanted.get(field): issues.append(field+'_drift')
  schedule=actual.get('schedule')
  wanted_schedule=wanted['schedule']
  if not isinstance(schedule,dict) or any(schedule.get(k)!=v for k,v in wanted_schedule.items() if k!='display'): issues.append('schedule_drift')
  if wanted.get('monitor_script') and Path(str(actual.get('monitor_script') or '')).name!=wanted['monitor_script']: issues.append('monitor_script_drift')
  reports.append({'id':jid,'configuration_matches':not issues,'last_status':actual.get('last_status'),'last_run_at':actual.get('last_run_at'),'next_run_at':actual.get('next_run_at'),'actual_runtime_model':'unknown'})
  blockers.extend(jid+':'+issue for issue in issues)
 extras=[j for j in jobs if j.get('id') not in expected and 'morrow' in str(j.get('name','')).lower()]
 if extras: blockers.append('unexpected_morrow_jobs')
 return {'ok':not blockers,'blockers':blockers,'jobs':reports,'additional_morrow_job_count':len(extras),'global_fallback':'not_inspected_unchanged'}

def credential_metadata(path):
 try:
  st=path.lstat()
  return {'present':True,'safe_metadata':stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode)==0o600 and st.st_uid==os.getuid(),'contents_read':False}
 except FileNotFoundError: return {'present':False,'safe_metadata':False,'contents_read':False}

def doctor(hermes,project):
 setup=project/'capital/morrow/setup'
 result={'checked_at':datetime.now(timezone.utc).isoformat(),'platform':platform.system(),'python_supported':sys.version_info>=(3,9),'providers':{'alpaca':'disabled_pending_owner','tiingo':'disabled_pending_owner'},'new_openings_allowed':False,'real_trading_allowed':False}
 result['scripts_present']={n:(hermes/'scripts'/n).is_file() for n in ('morrow_finance_bridge.py','morrow_proposal_trigger.py','morrow_runtime.py','morrow_mac_doctor.py')}
 result['bridge_credential']=credential_metadata(hermes/'secrets/morrow-bridge-key')
 try: result['scheduler']=audit_jobs(json.loads((hermes/'cron/jobs.json').read_text()),json.loads((setup/'scheduler-baseline.json').read_text()))
 except (OSError,ValueError,KeyError,TypeError): result['scheduler']={'ok':False,'blockers':['scheduler_or_baseline_unavailable']}
 result['blockers']=['backend_deployment_unverified','paid_data_deferred','mac_actual_runs_unverified','calendar_timezone_readback_required']
 if not all(result['scripts_present'].values()): result['blockers'].append('scripts_missing')
 if not result['bridge_credential']['safe_metadata']: result['blockers'].append('bridge_credential_missing_or_unsafe')
 if not result['scheduler']['ok']: result['blockers'].append('scheduler_drift_or_unavailable')
 result['research_installation_ok']=all(result['scripts_present'].values()) and result['python_supported'] and result['scheduler']['ok']
 return result

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--hermes-home',type=Path,default=Path.home()/'.hermes');p.add_argument('--project',type=Path,default=Path.home()/'Projects/Hunter/maddox-command')
 a=p.parse_args();result=doctor(a.hermes_home,a.project);print(json.dumps(result,indent=2))
 return 0 if result['research_installation_ok'] else 2

if __name__=='__main__': raise SystemExit(main())
