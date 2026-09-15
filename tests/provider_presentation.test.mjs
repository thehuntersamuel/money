import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function providerPresentation('),html.indexOf('function renderMorrowSummary('));
const present=runInNewContext(source+';providerPresentation');
const now=Date.parse('2026-09-05T05:00:00Z');
test('a stopped feed shows its failure even when the last heartbeat is old',()=>{
 const result=present({available:true,rows:[{dataset:'alpaca_sip',status:'failed',checked_at:'2026-09-04T08:12:27Z',detail:JSON.stringify({s:'stream_stopped_operator_review_required',r:'stream_backpressure_gap',e:Date.parse('2026-09-04T08:12:19Z')})}]},'alpaca_sip',now);
 assert.equal(result.title,'Price feed stopped');assert.match(JSON.stringify(result),/Last saved market event/);
});
test('daily and news snapshots remain dated samples, not continuous healthy feeds',()=>{
 for(const [dataset,title] of [['tiingo_eod','Daily history saved'],['tiingo_news','News sample saved']]){
  const result=present({available:true,rows:[{dataset,status:'ok',coverage:'result_limit_reached_narrow_time_window',checked_at:new Date(now-86400000).toISOString()}]},dataset,now);
  assert.equal(result.title,title);assert.doesNotMatch(result.note,/result_limit_|requested_EOD|healthy/);
 }
 const stale=present({available:true,rows:[{dataset:'alpaca_sip',status:'blocked',coverage:'stale_symbols:AAPL,ADBE,SPY',checked_at:new Date(now).toISOString()}]},'alpaca_sip',now);
 assert.match(stale.note,/Waiting for fresh/);assert.doesNotMatch(stale.note,/stale_symbols/);
});
test('provider UI never promotes missing, blocked, future or stale receipts to healthy',()=>{
 assert.equal(present(null,'alpaca_sip',now).title,'Status unavailable');
 assert.equal(present({available:true,rows:[]},'tiingo_news',now).title,'Awaiting ingestion receipt');
 for(const [status,at,title] of [['blocked',now,'Awaiting verified coverage'],['failed',now,'Feed needs attention'],['ok',now-600001,'Receipt needs refresh'],['ok',now+1,'Receipt needs refresh'],['ok',now,'Feed reporting healthy']]){
  assert.equal(present({available:true,rows:[{dataset:'alpaca_sip',status,checked_at:new Date(at).toISOString()}]},'alpaca_sip',now).title,title);
 }
});
test('week-old paid-data samples need refresh without asserting the provider is down',()=>{
 for(const dataset of ['tiingo_eod','tiingo_news']){
  const r=present({available:true,rows:[{dataset,status:'ok',checked_at:new Date(now-7*86400000).toISOString()}]},dataset,now);
  assert.equal(r.title,'Saved sample needs refresh');assert.match(r.note,/does not establish current provider availability/);
 }
});
