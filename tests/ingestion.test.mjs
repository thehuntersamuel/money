import {connectSip,supabaseObservationStore} from '../server/ingestion.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
class Socket {
 handlers={};sent=[];closed=false;
 addEventListener(k,f){this.handlers[k]=f;}
 send(x){this.sent.push(JSON.parse(x));}
 close(){this.closed=true;}
 emit(k,x){this.handlers[k]?.(k==='message'?{data:JSON.stringify(x)}:x);}
}
test('SIP worker requires subscription, serializes durable writes and reports disconnect',async()=>{
 const socket=new Socket(),stored=[],health=[];
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:[]}}),socketFactory:url=>{assert.match(url,/\/sip$/);return socket;},
  store:async rows=>stored.push(...rows),calendar:async()=> 'regular',now:()=> '2026-09-04T15:00:00Z',onHealth:async r=>health.push(r)});
 socket.emit('open');socket.emit('message',[{T:'success',msg:'authenticated'}]);await worker.drain();
 assert.deepEqual(socket.sent[1],{action:'subscribe',trades:['SPY']});
 socket.emit('message',[{T:'subscription',trades:['SPY']},{T:'t',S:'SPY',p:100,i:1,t:'2026-09-04T15:00:00Z'}]);await worker.drain();
 assert.equal(stored.length,1);assert.equal(stored[0].is_test,false);assert(worker.isHealthy());
 socket.emit('close');assert(!worker.isHealthy());assert.equal(health.at(-1).status,'disconnected');
});
test('persistence failure stops streaming rather than dropping observations silently',async()=>{
 const socket=new Socket();
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
 fetchImpl:async()=>Response.json({trades:{SPY:[]}}),socketFactory:()=>socket,calendar:async()=> 'regular',store:async()=>{throw Error('TEST failure')},now:()=> '2026-09-04T15:00:00Z'});
 socket.emit('message',[{T:'subscription',trades:['SPY']},{T:'t',S:'SPY',p:100,i:1,t:'2026-09-04T15:00:00Z'}]);await worker.drain();assert(socket.closed);assert(!worker.isHealthy());
});
test('store is scoped to the approved project and ignores duplicate source IDs',async()=>{
 assert.throws(()=>supabaseObservationStore({url:'https://other.supabase.co',serviceRole:'TEST'}),/approved/);
 const store=supabaseObservationStore({url:'https://fglbxoafbebsryjeqcbu.supabase.co',serviceRole:'TEST',fetchImpl:async(url,options)=>{assert.equal(url.searchParams.get('on_conflict'),'source_id');assert.match(options.headers.prefer,/ignore-duplicates/);return new Response(null,{status:201});}});
 await store([{source_id:'TEST'}]);
});

test('regular-session silence loses health and closes for replay; unknown sessions never certify freshness',async()=>{
 let clock='2026-09-04T15:00:00Z',session='regular';const socket=new Socket(),health=[];
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:clock.includes('19:')?[{p:100,i:99,t:clock}]:[]}}),socketFactory:()=>socket,store:async()=>{},
  calendar:async()=>session,now:()=>clock,onHealth:async value=>health.push(value)});
 socket.emit('message',[{T:'subscription',trades:['SPY']}]);await worker.drain();
 assert.equal((await worker.checkHealth()).status,'coverage_unknown_or_stale');
 clock='2026-09-04T19:00:00Z';assert.equal(worker.isHealthy(),false);
 await worker.checkHealth();assert(socket.closed);assert.equal(health.at(-1).reason,'stream_stale_coverage_gap');
});
test('successful writes expose event freshness separately from heartbeat',async()=>{
 let clock='2026-09-04T15:00:00Z',session='regular';const socket=new Socket();
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:[]}}),socketFactory:()=>socket,store:async()=>{},
  calendar:async()=>session,now:()=>clock});
 socket.emit('message',[{T:'subscription',trades:['SPY']},{T:'t',S:'SPY',p:100,i:1,t:clock}]);await worker.drain();
 assert.equal((await worker.checkHealth()).status,'observations_fresh');
 session='unknown';clock='2026-09-05T15:00:00Z';
 const status=await worker.checkHealth();assert.equal(status.status,'coverage_unknown_or_stale');
 assert.equal(status.last_event_at,'2026-09-04T15:00:00Z');worker.stop();
});

test('quiet symbols retain stale coverage without consuming reconnect budget',async()=>{
 let clock='2026-09-04T15:00:00Z';const socket=new Socket();
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:[]}}),socketFactory:()=>socket,store:async()=>{},calendar:async()=> 'regular',now:()=>clock});
 socket.emit('message',[{T:'subscription',trades:['SPY']}]);await worker.drain();clock='2026-09-04T19:00:00Z';
 const health=await worker.checkHealth();assert.equal(health.status,'coverage_unknown_or_stale');
 assert.deepEqual(health.stale_symbols,['SPY']);assert(worker.isConnected());assert(!worker.isHealthy());assert(!socket.closed);worker.stop();
});
