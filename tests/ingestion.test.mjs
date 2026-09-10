import {connectSip,supabaseObservationStore} from '../server/ingestion.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
class Socket {
 handlers={};sent=[];closed=false;
 addEventListener(k,f){this.handlers[k]=f;}
 send(x){this.sent.push(JSON.parse(x));}
 close(){this.closed=true;}
 emit(k,x){this.handlers[k]?.(k==='message'?{data:JSON.stringify(x)}:x);}
}
test('bursty frames are coalesced and accepted observations drain after overflow',async()=>{
 const socket=new Socket(),stored=[],sizes=[];let release;
 const held=new Promise(resolve=>{release=resolve});
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{}}),socketFactory:()=>socket,calendar:async()=> 'regular',
  now:()=> '2026-09-04T15:00:00Z',store:async rows=>{await held;sizes.push(rows.length);stored.push(...rows)}});
 socket.emit('message',[{T:'subscription',trades:['SPY']}]);await worker.drain();
 const trade=i=>({T:'t',S:'SPY',p:100,i,t:'2026-09-04T15:00:00Z'});
 for(let i=0;i<101;i++)socket.emit('message',[trade(i)]);
 await new Promise(resolve=>setImmediate(resolve));
 assert(!socket.closed);release();await worker.drain();
 assert.equal(stored.length,101);assert.deepEqual(sizes,[101]);
 // Fill the bounded queue synchronously. The rejected frame is a declared gap;
 // the 20,000 records already accepted must still be written before shutdown.
 for(let i=0;i<20001;i++)socket.emit('message',[trade(i+1000)]);
 await worker.drain();assert(socket.closed);assert.equal(worker.failure(),'stream_backpressure_gap');
 assert.equal(stored.length,20101);assert(sizes.every(n=>n<=1000));
 socket.emit('close',{code:1006});assert.equal(worker.failure(),'stream_backpressure_gap');
});
test('a quiet peer and REST leading the live frontier cannot force a reconnect',async()=>{
 let clock='2026-09-04T15:00:00.000Z';const socket=new Socket(),requests=[];
 const worker=await connectSip({symbols:['SPY','QUIET'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async url=>{requests.push(new URL(url));return Response.json({trades:{}})},
  socketFactory:()=>socket,calendar:async()=> 'regular',store:async()=>{},now:()=>clock});
 socket.emit('message',[{T:'subscription',trades:['SPY','QUIET']}]);await worker.drain();
 clock='2026-09-04T15:03:00.000Z';
 socket.emit('message',[{T:'t',S:'SPY',p:100,i:1,t:'2026-09-04T15:02:59.998Z'}]);await worker.drain();
 const health=await worker.checkHealth();assert(!socket.closed);assert.equal(health.status,'coverage_unknown_or_stale');
 assert.equal(requests.at(-1).searchParams.get('symbols'),'QUIET');
 assert.equal(requests.at(-1).searchParams.get('end'),'2026-09-04T15:02:45.000Z');worker.stop();
});
test('durable replay initializes event freshness and stream failures preserve their code',async()=>{
 const socket=new Socket();const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:[{p:100,i:1,t:'2026-09-04T15:00:00Z'}]}}),
  socketFactory:()=>socket,calendar:async()=> 'regular',store:async()=>{},now:()=> '2026-09-04T15:00:00Z'});
 socket.emit('message',[{T:'subscription',trades:['SPY']}]);await worker.drain();
 assert.equal((await worker.checkHealth()).status,'observations_fresh');
 socket.emit('message',[{T:'error',code:407,msg:'raw provider text must not become a log'}]);await worker.drain();
 assert.equal(worker.failure(),'stream_error_407');assert(!worker.isConnected());
});
test('SIP worker requires subscription, serializes durable writes and reports disconnect',async()=>{
 const socket=new Socket(),stored=[],health=[];
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:[]}}),socketFactory:url=>{assert.match(url,/\/sip$/);return socket;},
  store:async rows=>stored.push(...rows),calendar:async()=> 'regular',now:()=> '2026-09-04T15:00:00Z',onHealth:async r=>health.push(r)});
 socket.emit('open');socket.emit('message',[{T:'success',msg:'authenticated'}]);await worker.drain();
 assert.deepEqual(socket.sent[1],{action:'subscribe',trades:['SPY']});
 socket.emit('message',[{T:'subscription',trades:['SPY']},{T:'t',S:'SPY',p:100,i:1,t:'2026-09-04T15:00:00Z'}]);await worker.drain();
 assert.equal(stored.length,1);assert.equal(stored[0].is_test,false);assert(worker.isHealthy());
 socket.emit('close');assert(!worker.isHealthy());assert.equal(health.at(-1).status,'failed');assert.equal(worker.failure(),'socket_closed_0');
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
test('uncertain durable writes retry idempotently without retrying unauthorized writes',async()=>{
 let calls=0;const bodies=[];
 const store=supabaseObservationStore({url:'https://fglbxoafbebsryjeqcbu.supabase.co',serviceRole:'TEST',sleep:async()=>{},fetchImpl:async(url,options)=>{
  bodies.push(options.body);if(++calls===1)throw Error('timeout after commit');return new Response(null,{status:201});
 }});
 await store([{source_id:'TEST:unique'}]);assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);
 calls=0;const denied=supabaseObservationStore({url:'https://fglbxoafbebsryjeqcbu.supabase.co',serviceRole:'TEST',fetchImpl:async()=>{calls++;return new Response(null,{status:401})}});
 await assert.rejects(()=>denied([{source_id:'TEST'}]),/persistence_http_401/);assert.equal(calls,1);
});

test('regular-session silence loses health and closes for replay; unknown sessions never certify freshness',async()=>{
 let clock='2026-09-04T15:00:00Z',session='regular';const socket=new Socket(),health=[];
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,
  fetchImpl:async()=>Response.json({trades:{SPY:clock.includes('19:')?[{p:100,i:99,t:new Date(Date.parse(clock)-30000).toISOString()}]:[]}}),socketFactory:()=>socket,store:async()=>{},
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

test('new research symbols subscribe on the same socket and wait for acknowledgement',async()=>{
 const socket=new Socket(),stored=[];let sockets=0,clock='2026-09-04T15:00:00Z';
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,fetchImpl:async()=>Response.json({trades:{}}),socketFactory:()=>{sockets++;return socket},store:async rows=>stored.push(...rows),calendar:async()=> 'regular',now:()=>clock});
 socket.emit('message',[{T:'subscription',trades:['SPY']}]);await worker.drain();
 await worker.updateSymbols(['AAPL','SPY']);
 assert.equal(sockets,1);assert.deepEqual(socket.sent.at(-1),{action:'subscribe',trades:['AAPL']});assert(worker.isConnected());assert(!worker.isHealthy());
 socket.emit('message',[{T:'subscription',trades:['SPY','AAPL']},{T:'t',S:'AAPL',p:200,i:2,t:clock}]);await worker.drain();
 assert.equal(stored.at(-1).symbol,'AAPL');assert.equal(stored.at(-1).gap,false);
 await worker.updateSymbols(['AAPL']);assert.deepEqual(socket.sent.at(-1),{action:'unsubscribe',trades:['SPY']});
 socket.emit('message',[{T:'subscription',trades:['AAPL']}]);await worker.drain();assert(worker.isHealthy());worker.stop();
});
test('missing acknowledgement fails closed without inventing coverage',async()=>{
 const socket=new Socket();let clock='2026-09-04T15:00:00Z';
 const worker=await connectSip({symbols:['SPY'],keyId:'TEST',secret:'TEST',licensed:true,fetchImpl:async()=>Response.json({trades:{}}),socketFactory:()=>socket,store:async()=>{},calendar:async()=> 'regular',now:()=>clock});
 socket.emit('message',[{T:'subscription',trades:['SPY']}]);await worker.drain();await worker.updateSymbols(['SPY','AAPL']);clock='2026-09-04T15:00:31Z';await worker.checkHealth();assert(socket.closed);assert(!worker.isConnected());
});
