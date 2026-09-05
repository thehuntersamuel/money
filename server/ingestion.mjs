import {makeMarketData,normalizeTrade,universe,SIP_STREAM} from './market-data.mjs';

// Deterministic worker, never a scheduler or an LLM job. Run only after licensing,
// server-secret provisioning and the live canary described in the release gates.
export async function connectSip({symbols,keyId,secret,licensed=false,store,calendar,
 socketFactory=url=>new WebSocket(url),now=()=>new Date().toISOString(),onHealth=async()=>{},
 fetchImpl=fetch}) {
 universe(symbols);
 if(!licensed||!keyId||!secret)throw new Error('licensed SIP access and secure credentials required');
 if(typeof store!=='function'||typeof calendar!=='function')throw new Error('durable store and official calendar required');
 const api=makeMarketData({keyId,secret,licensed,fetchImpl});
 let healthy=false,closed=false,pending=0,queue=Promise.resolve();
 // Recover the preceding hour. A bounded recovery does not certify earlier gaps.
 const end=now(),start=new Date(Date.parse(end)-3600000).toISOString();
 const recovered=await api.backfillTrades(symbols,start,end);
 for(let i=0;i<recovered.records.length;i+=250) {
  const batch=[];
  for(const {symbol,row} of recovered.records.slice(i,i+250))batch.push(normalizeTrade(symbol,row,{receivedAt:now(),session:await calendar(row.t),gap:true,isTest:false}));
  await store(batch);
 }
 await onHealth({status:recovered.coverage_complete?'bounded_replay_complete':'coverage_gap',start,end,earlier_coverage:'unknown'});
 let coverageComplete=recovered.coverage_complete;
 const socket=socketFactory(SIP_STREAM);
 async function fail(reason){healthy=false;closed=true;socket.close();try{await onHealth({status:'failed',reason,at:now()});}catch{/* Already failed closed; no unhandled secret-bearing error. */}}
 socket.addEventListener('open',()=>socket.send(JSON.stringify({action:'auth',key:keyId,secret})));
 socket.addEventListener('message',event=>{
  if(closed)return;
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
      healthy=Array.isArray(row.trades)&&symbols.every(s=>row.trades.includes(s));
      if(!healthy)throw new Error('incomplete_stream_subscription');
      // Close the REST-to-WebSocket handoff interval; duplicates share source IDs.
      const subscribedAt=now();
      if(Date.parse(subscribedAt)>Date.parse(end)) {
        const overlap=await api.backfillTrades(symbols,end,subscribedAt);
        coverageComplete=coverageComplete&&overlap.coverage_complete;
        for(let i=0;i<overlap.records.length;i+=250) {
          const recoveredBatch=[];
          for(const {symbol,row:trade} of overlap.records.slice(i,i+250))recoveredBatch.push(normalizeTrade(symbol,trade,{receivedAt:now(),session:await calendar(trade.t),gap:!coverageComplete,isTest:false}));
          await store(recoveredBatch);
        }
      }
      await onHealth({status:'sip_subscribed',at:now(),coverage_start:start,backfill_complete:coverageComplete});
    }
    if(row.T==='t'){
      if(!healthy||!symbols.includes(row.S))throw new Error('unexpected_stream_trade');
      batch.push(normalizeTrade(row.S,row,{receivedAt:now(),session:await calendar(row.t),gap:!coverageComplete,isTest:false}));
    }
   }
   if(batch.length)await store(batch); // Failure closes socket; supervisor must replay before reconnecting.
  }).catch(()=>fail('stream_or_persistence_failure')).finally(()=>{pending--;});
 });
 socket.addEventListener('close',()=>{healthy=false;closed=true;try{void Promise.resolve(onHealth({status:'disconnected',at:now(),coverage:'gap_until_replay'})).catch(()=>{});}catch{/* Remain disconnected. */}});
 socket.addEventListener('error',()=>{void fail('stream_connection_failure');});
 return {stop:()=>{closed=true;healthy=false;socket.close();},drain:()=>queue,isHealthy:()=>healthy};
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
