import test from 'node:test';
import assert from 'node:assert/strict';
import {supervise,healthDetail} from '../server/sip-worker.mjs';
test('health receipts retain cause and last event within the database limit',()=>{
 const value=healthDetail({status:'x'.repeat(200),reason:'y'.repeat(200),last_event_at:'2026-09-08T08:12:19.037Z',last_persisted_at:'2026-09-08T08:12:19.874Z',pending_records:20000});
 assert(value.length<=200);assert.equal(JSON.parse(value).e,Date.parse('2026-09-08T08:12:19.037Z'));
 assert.equal(JSON.parse(healthDetail({reason:'https://example.com/?token=SECRET'})).r,null);
});
test('persistent worker enforces reconnect budget',async()=>{
 let attempts=0;const abort=new AbortController();
 await assert.rejects(()=>supervise({signal:abort.signal,sleep:async()=>{},connect:async()=>{attempts++;throw Error('TEST unavailable')}}),/budget exhausted/);
 assert.equal(attempts,5);
});
test('shutdown stops and drains the active worker',async()=>{
 const abort=new AbortController();let stopped=0,drained=0;
 const result=await supervise({signal:abort.signal,sleep:async()=>abort.abort(),connect:async()=>({isHealthy:()=>true,drain:async()=>{drained++;},stop:()=>{stopped++;}})});
 assert.equal(result.stopped,true);assert.equal(stopped,1);assert.ok(drained>=1);
});
