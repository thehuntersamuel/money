import {streamUniverse} from './subscriptions.mjs';
import {makeMarketData,normalizeTrade,universe,SIP_STREAM} from './market-data.mjs';

// Deterministic worker, never a scheduler or an LLM job. Run only after licensing,
// server-secret provisioning and the live canary described in the release gates.
export async function connectSip({symbols,keyId,secret,licensed=false,store,calendar,
 socketFactory=url=>new WebSocket(url),now=()=>new Date().toISOString(),onHealth=async()=>{},
 fetchImpl=fetch}) {
 symbols=streamUniverse(symbols);
 if(!licensed||!keyId||!secret)throw new Error('licensed SIP access and secure credentials required');
 if(typeof store!=='function'||typeof calendar!=='function')throw new Error('durable store and official calendar required');
 const api=makeMarketData({keyId,secret,licensed,fetchImpl});
 let healthy=false,closed=false,pending=0,queue=Promise.resolve();
 let subscribedAt=null,lastMessageAt=null,lastPersistedAt=null,lastEventAt=null,currentSession='unknown',lastProbeAt=null;
 const persistedEvents=new Map();
 const age=at=>at?Date.parse(now())-Date.parse(at):Infinity;
 const activeSession=()=>['regular','extended'].includes(currentSession);
 const fresh=()=>symbols.every(symbol=>age(persistedEvents.get(symbol))<=120000);
 const stalled=()=>healthy&&activeSession()&&age(subscribedAt)>120000&&(!fresh()||age(lastMessageAt)>120000||age(lastPersistedAt)>120000);
 // Recover the preceding hour. A bounded recovery does not certify earlier gaps.
 const end=now(),start=new Date(Date.parse(end)-3600000).toISOString();
 async function replay(list,from,to,gap=true){
  let complete=true;
  for(let offset=0;offset<list.length;offset+=30){
   const result=await api.backfillTrades(list.slice(offset,offset+30),from,to);
   complete=complete&&result.coverage_complete;
   for(let i=0;i<result.records.length;i+=250){const batch=[];for(const {symbol,row} of result.records.slice(i,i+250))batch.push(normalizeTrade(symbol,row,{receivedAt:now(),session:await calendar(row.t),gap:gap||!result.coverage_complete,isTest:false}));await store(batch);}
  }return complete;
 }
 let coverageComplete=await replay(symbols,start,end);
 await onHealth({status:coverageComplete?'bounded_replay_complete':'coverage_gap',start,end,earlier_coverage:'unknown'});
 let changingAt=null,acknowledged=[],replayEnd=end;
 const socket=socketFactory(SIP_STREAM);
 async function fail(reason){healthy=false;closed=true;socket.close();try{await onHealth({status:'failed',reason,at:now()});}catch{/* Already failed closed; no unhandled secret-bearing error. */}}
 socket.addEventListener('open',()=>socket.send(JSON.stringify({action:'auth',key:keyId,secret})));
 socket.addEventListener('message',event=>{
  if(closed)return;
  lastMessageAt=now();
  if(++pending>100){void fail('stream_backpressure_gap');return;}
  queue=queue.then(async()=>{
   if(closed)return;
   let messages;try{messages=JSON.parse(event.data);}catch{throw new Error('invalid_stream_json');}
   if(!Array.isArray(messages)||messages.length>10000)throw new Error('invalid_stream_batch');
   const batch=[];
   for(const row of messages){
    if(row.T==='error')throw new Error(`stream_error_${Number(row.code)||0}`);
    if(row.T==='success'&&row.msg==='authenticated')socket.send(JSON.stringify({action:'subscribe',trades:symbols}));
    if(row.T==='subscription'){
      if(!Array.isArray(row.trades))throw Error('invalid_stream_subscription');
      acknowledged=row.trades;
      healthy=symbols.every(s=>row.trades.includes(s));
      // Unsubscribe and subscribe may yield an intermediate acknowledgement.
      if(!healthy){if(!changingAt)throw Error('incomplete_stream_subscription');continue;}
      subscribedAt=now();currentSession=await calendar(subscribedAt);
      if(Date.parse(subscribedAt)>Date.parse(replayEnd))coverageComplete=(await replay(symbols,replayEnd,subscribedAt,!coverageComplete))&&coverageComplete;
      changingAt=null;
      await onHealth({status:'sip_subscribed',at:now(),coverage_start:start,backfill_complete:coverageComplete,symbol_count:symbols.length,symbols:[...symbols]});
    }
    if(row.T==='t'){
      if(!symbols.includes(row.S))continue; // In-flight events for removed symbols are not new evidence.
      if(!healthy&&!changingAt)throw new Error('unexpected_stream_trade');
      batch.push(normalizeTrade(row.S,row,{receivedAt:now(),session:await calendar(row.t),gap:!coverageComplete||!!changingAt,isTest:false}));
    }
   }
   if(batch.length){
    await store(batch); // Mark freshness only after the durable write succeeds.
    lastPersistedAt=now();
    for(const row of batch){
     if(!persistedEvents.has(row.symbol)||row.event_at>persistedEvents.get(row.symbol))persistedEvents.set(row.symbol,row.event_at);
     if(!lastEventAt||row.event_at>lastEventAt)lastEventAt=row.event_at;
    }
   }
  }).catch(()=>fail('stream_or_persistence_failure')).finally(()=>{pending--;});
 });
 socket.addEventListener('close',()=>{healthy=false;closed=true;try{void Promise.resolve(onHealth({status:'disconnected',at:now(),coverage:'gap_until_replay'})).catch(()=>{});}catch{/* Remain disconnected. */}});
 socket.addEventListener('error',()=>{void fail('stream_connection_failure');});
 return {stop:()=>{closed=true;healthy=false;socket.close();},drain:()=>queue,
  isConnected:()=>subscribedAt!==null&&!closed,
  updateSymbols:async values=>{
   const next=streamUniverse(values);if(next.join(',')===symbols.join(','))return;
   if(closed)throw Error('stream is closed');if(changingAt)throw Error('subscription change is still pending');
   queue=queue.then(async()=>{
    const added=next.filter(s=>!symbols.includes(s)),removed=symbols.filter(s=>!next.includes(s));
    const until=now(),since=new Date(Date.parse(until)-3600000).toISOString();
    if(added.length)coverageComplete=(await replay(added,since,until))&&coverageComplete;
    symbols=next;replayEnd=until;changingAt=now();healthy=false;
    for(const symbol of removed)persistedEvents.delete(symbol);
    if(removed.length)socket.send(JSON.stringify({action:'unsubscribe',trades:removed}));
    if(added.length)socket.send(JSON.stringify({action:'subscribe',trades:added}));
   }).catch(async()=>{await fail('subscription_update_failed');throw Error('subscription update failed');});
   await queue;
  },
  isHealthy:()=>healthy&&!closed&&!stalled(),
  checkHealth:async()=>{
   if(changingAt&&age(changingAt)>30000)await fail('subscription_ack_timeout');
   currentSession=await calendar(now());
   // Silence may be a quiet symbol. Compare bounded REST evidence before
   // classifying the connection as stalled; freshness remains blocked meanwhile.
   if(stalled()&&age(lastProbeAt)>120000){
    lastProbeAt=now();
    try{
     for(let offset=0;offset<symbols.length;offset+=30){
      const probe=await api.backfillTrades(symbols.slice(offset,offset+30),new Date(Date.parse(now())-120000).toISOString(),now());
      if(!probe.coverage_complete){await fail('stream_liveness_reconciliation_incomplete');break;}
      else if(probe.records.some(({symbol,row})=>!persistedEvents.has(symbol)||row.t>persistedEvents.get(symbol))){await fail('stream_stale_coverage_gap');break;}
     }
    }catch{await fail('stream_liveness_reconciliation_failed');}
   }
   return {status:healthy&&coverageComplete&&activeSession()&&fresh()?'observations_fresh':'coverage_unknown_or_stale',
    symbol_count:symbols.length,acknowledged_count:acknowledged.length,subscription_pending:!!changingAt,connected:healthy&&!closed,session:currentSession,stale_symbols:symbols.filter(s=>age(persistedEvents.get(s))>120000),last_message_at:lastMessageAt,
    last_event_at:lastEventAt,last_persisted_at:lastPersistedAt,backfill_complete:coverageComplete};
  }};
}

export function supabaseObservationStore({url,serviceRole,fetchImpl=fetch}) {
 const base=new URL(url);
 if(base.protocol!=='https:'||base.hostname!=='fglbxoafbebsryjeqcbu.supabase.co'||!serviceRole)throw new Error('approved server store required');
 return async rows=>{
  if(!rows.length)return;
  const endpoint=new URL('/rest/v1/morrow_market_observations?on_conflict=source_id',base);
  let res;try{res=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:serviceRole,authorization:`Bearer ${serviceRole}`,'content-type':'application/json',prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(rows)});}catch{throw new Error('observation persistence unavailable');}
  if(!res.ok)throw new Error(`observation persistence status ${res.status}`);
 };
}
