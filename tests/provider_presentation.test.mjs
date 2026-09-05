import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function providerPresentation('),html.indexOf('function renderMorrowSummary('));
const present=runInNewContext(source+';providerPresentation');
const now=Date.parse('2026-09-05T05:00:00Z');
test('provider UI never promotes missing, blocked, future or stale receipts to healthy',()=>{
 assert.equal(present(null,'alpaca_sip',now).title,'Status unavailable');
 assert.equal(present({available:true,rows:[]},'tiingo_news',now).title,'Awaiting ingestion receipt');
 for(const [status,at,title] of [['blocked',now,'Awaiting verified coverage'],['failed',now,'Feed needs attention'],['ok',now-600001,'Receipt needs refresh'],['ok',now+1,'Receipt needs refresh'],['ok',now,'Feed reporting healthy']]){
  assert.equal(present({available:true,rows:[{dataset:'alpaca_sip',status,checked_at:new Date(at).toISOString()}]},'alpaca_sip',now).title,title);
 }
});
