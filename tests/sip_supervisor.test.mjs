import test from 'node:test';
import assert from 'node:assert/strict';
import {supervise} from '../server/sip-worker.mjs';
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
