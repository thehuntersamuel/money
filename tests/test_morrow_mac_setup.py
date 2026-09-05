import importlib.util
import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def module(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj

setup=module('morrow_mac_setup');doctor=module('morrow_mac_doctor');runtime=module('morrow_runtime')

class MacSetupTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.hermes=self.root/'hermes';self.project=self.root/'project'
  (self.hermes/'scripts').mkdir(parents=True);(self.hermes/'cron').mkdir()
  self.project.mkdir()
  self.jobs=json.loads((ROOT/'mac/scheduler-baseline.json').read_text())
  (self.hermes/'cron/jobs.json').write_text(json.dumps(self.jobs))
 def tearDown(self): self.tmp.cleanup()
 def test_install_backup_and_rollback_preserve_jobs_and_ledger(self):
  target=self.hermes/'scripts/morrow_finance_bridge.py';target.write_text('original');target.chmod(0o700)
  original=(self.hermes/'cron/jobs.json').read_bytes()
  result=setup.install(self.hermes,self.project)
  self.assertFalse(result['providers_enabled'])
  self.assertIn('new_openings_allowed',result)
  state=self.project/'capital/morrow/research-ledger.sqlite3';state.write_text('preserved TEST ledger')
  setup.rollback(Path(result['manifest']))
  self.assertEqual(target.read_text(),'original')
  self.assertEqual(target.stat().st_mode&0o777,0o700)
  self.assertEqual(state.read_text(),'preserved TEST ledger')
  self.assertEqual((self.hermes/'cron/jobs.json').read_bytes(),original)
 def test_symlink_and_rollback_drift_rejected(self):
  outside=self.root/'outside';outside.write_text('unchanged')
  target=self.hermes/'scripts/morrow_runtime.py';target.symlink_to(outside)
  with self.assertRaises(ValueError): setup.install(self.hermes,self.project)
  self.assertEqual(outside.read_text(),'unchanged');target.unlink()
  result=setup.install(self.hermes,self.project);target.write_text('local change')
  with self.assertRaises(ValueError): setup.rollback(Path(result['manifest']))
  self.assertEqual(target.read_text(),'local change')
 def test_doctor_no_secret_read_and_config_is_not_readiness(self):
  setup.install(self.hermes,self.project)
  result=doctor.doctor(self.hermes,self.project)
  self.assertTrue(result['research_installation_ok'])
  self.assertFalse(result['new_openings_allowed'])
  self.assertFalse(result['bridge_credential']['contents_read'])
  self.assertIn('bridge_credential_missing_or_unsafe',result['blockers'])
 def test_scheduler_route_cadence_monitor_and_duplicate_drift(self):
  self.assertTrue(doctor.audit_jobs(self.jobs,self.jobs)['ok'])
  for field,value in [('model','local'),('enabled',False),('schedule',{}),('reasoning_effort','low')]:
   copy=json.loads(json.dumps(self.jobs));copy['jobs'][0][field]=value
   self.assertFalse(doctor.audit_jobs(copy,self.jobs)['ok'])
  copy=json.loads(json.dumps(self.jobs));copy['jobs'].append(dict(copy['jobs'][0],id='extra'))
  self.assertIn('unexpected_morrow_jobs',doctor.audit_jobs(copy,self.jobs)['blockers'])

class RuntimeTests(unittest.TestCase):
 def setUp(self): self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
 def tearDown(self): self.tmp.cleanup()
 def test_concurrent_idempotency_and_immutable_history(self):
  data={'subject':'TEST concurrency','status':'blocked'}
  with ThreadPoolExecutor(max_workers=6) as pool:
   results=list(pool.map(lambda _:runtime.append(self.root,'audit','test:key',data),range(6)))
  self.assertEqual(len({x['id'] for x in results}),1)
  self.assertEqual(sum(not x['replayed'] for x in results),1)
  with self.assertRaises(ValueError):runtime.append(self.root,'audit','test:key',dict(data,status='ok'))
  db=runtime.connect(self.root)
  try:
   for sql in ('DELETE FROM records','UPDATE records SET kind=\'run\''):
    with self.assertRaises(Exception): db.execute(sql)
  finally: db.close()
  self.assertEqual(len(list(runtime.export(self.root))),1)
 def test_references_unknown_costs_and_secret_fields(self):
  decision={'proposal_key':'TEST:SPY:v1','symbol':'SPY','disposition':'research_qualified','horizon':'swing','thesis':'TEST only','bear_case':'TEST only','missing_data':['SIP unavailable'],'benchmark':'SPY','source_ids':['absent','missing']}
  with self.assertRaises(ValueError):runtime.append(self.root,'decision','test:decision',decision)
  with self.assertRaises(ValueError):runtime.append(self.root,'audit','test:secret',{'subject':'TEST','status':'ok','api_key':'do not accept'})
  source={'url':'https://example.com/release?token=TEST','title':'TEST','source_type':'issuer','retrieved_at':'2026-09-05T00:00:00Z','retention_note':'metadata only'}
  with self.assertRaises(ValueError):runtime.append(self.root,'source','test:source',source)
  decision.update(disposition='watch',source_ids=[])
  saved=runtime.append(self.root,'decision','test:decision',decision)
  with self.assertRaises(ValueError):runtime.append(self.root,'outcome','test:outcome',{'decision_id':saved['id'],'cohort':'shadow'})
  result=runtime.append(self.root,'outcome','test:outcome',{'decision_id':saved['id'],'cohort':'shadow','gross_return':None,'missing_reason':'not matured'})
  self.assertFalse(result['hub_synced'])
 def test_fallback_fields_never_authorize_entries_or_freeze(self):
  run={'job_id':'TEST','started_at':'2026-09-05T00:00:00Z','finished_at':'2026-09-05T00:00:01Z','status':'blocked','actual_provider':'openai-codex','actual_model':'gpt-5.4'}
  runtime.append(self.root,'run','test:run',run)
  s=runtime.snapshot(self.root)
  self.assertFalse(s['new_openings_allowed']);self.assertIsNone(s['champion']);self.assertIsNone(s['evaluation_started_at'])
  self.assertEqual(s['providers']['alpaca'],'disabled_pending_owner')
 def test_full_research_references_and_repeat(self):
  ids=[]
  for i in range(2):
   data={'url':f'https://example.com/TEST-release-{i}','title':'TEST source','source_type':'issuer','released_at':'2026-09-04T12:00:00Z','retrieved_at':'2026-09-05T00:00:00Z','retention_note':'metadata only'}
   ids.append(runtime.append(self.root,'source',f'test:source:{i}',data)['id'])
  d={'proposal_key':'TEST:SPY:v1','symbol':'SPY','disposition':'research_qualified','horizon':'swing','thesis':'TEST','bear_case':'TEST','missing_data':['paid data unavailable'],'benchmark':'SPY','source_ids':ids}
  first=runtime.append(self.root,'decision','test:decision',d)
  second=runtime.append(self.root,'decision','test:decision',d)
  self.assertEqual(first['id'],second['id']);self.assertTrue(second['replayed'])

class BridgeSafetyTests(unittest.TestCase):
 def test_new_opening_blocked_before_credential_or_network(self):
  bridge=module('morrow_finance_bridge')
  def no_key(): raise AssertionError('credential should not be loaded')
  with self.assertRaisesRegex(RuntimeError,'disabled'):bridge.call_bridge('place_trade',key_loader=no_key)

if __name__=='__main__': unittest.main()

class RuntimeSyncTests(unittest.TestCase):
 def test_failed_sync_preserves_local_record_then_retry_is_idempotent(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);record=runtime.append(root,'audit','TEST:audit',{'subject':'TEST','status':'blocked'})
   calls=[]
   def unavailable(op,payload=None):
    if op=='research_state':return {'ok':True,'operation':op}
    raise RuntimeError('TEST interrupted network')
   with self.assertRaises(RuntimeError):runtime.sync(root,unavailable)
   self.assertEqual(len(list(runtime.export(root))),1)
   def bridge(op,payload=None):
    calls.append(op)
    if op=='research_state':return {'ok':True,'operation':op}
    self.assertEqual(payload['record']['idempotency_key'],'mac:'+record['id'])
    return {'receipt':{'verified':True,'id':'10000000-0000-0000-0000-000000000001','server_sha256':'a'*64}}
   self.assertEqual(runtime.sync(root,bridge)['synced'],1)
   self.assertEqual(runtime.sync(root,bridge)['synced'],0)
   self.assertEqual(calls.count('record_research'),1)
