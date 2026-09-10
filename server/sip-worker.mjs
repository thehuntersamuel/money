// Run only in an approved persistent SERVER runtime, never as a Morrow reasoning job.
import {connectSip,supabaseObservationStore} from './ingestion.mjs';
import {makeCalendar} from './calendar.mjs';
import {streamUniverse,subscriptionLoader,alpacaAssetResolver} from './subscriptions.mjs';
import {createAttemptBudget,parkUntilStopped} from './attempt-budget.mjs';
export async function supervise({connect,signal,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxAttempts=5,beforeAttempt=async()=>{},onFailure=()=>{},onHeartbeat=async()=>{},refreshSymbols=null}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw Error('reconnect budget must be 1-5');
 for(let attempt=0;attempt<maxAttempts&&!signal.aborted;attempt++){
  await beforeAttempt(); // Reserve durably before any provider call or socket.
  let worker;
  try{
   worker=await connect();
   // Allow subscription/replay handshake. Missing health never becomes ready by default.
   for(let i=0;i<60&&!signal.aborted&&!worker.isHealthy();i++)await sleep(1000);
   const connected=()=>worker.isConnected?worker.isConnected():worker.isHealthy();
   let ticks=0;
   while(!signal.aborted&&connected()){await sleep(1000);const health=worker.checkHealth?await worker.checkHealth():null;if(++ticks%30===0){await onHeartbeat(health);if(refreshSymbols)await worker.updateSymbols(await refreshSymbols());}}
   if(signal.aborted)return {stopped:true};
  }catch{await onFailure({status:'failed',reason:worker?.failure?.()||'connection_or_persistence_failure',attempt:attempt+1});}
  finally{worker?.stop();if(worker)await worker.drain().catch(()=>{});}
  if(attempt+1<maxAttempts&&!signal.aborted)await sleep(Math.min(30000,1000*2**attempt));
 }
 if(signal.aborted)return {stopped:true};
 throw Error('SIP reconnect budget exhausted; operator review required');
}
export function healthDetail(value){
 const text=x=>typeof x==='string'&&/^[a-z0-9_]+$/.test(x)?x.slice(0,48):null;
 const time=x=>Number.isFinite(Date.parse(x))?Date.parse(x):null;
 const detail={s:text(value.status),r:text(value.reason),e:time(value.last_event_at),p:time(value.last_persisted_at),q:Number.isInteger(value.pending_records)?Math.max(0,Math.min(20000,value.pending_records)):0};
 return JSON.stringify(detail);
}
async function main(){
 if(process.env.MORROW_INGEST_ENABLED!=='true'){const parked=process.env.MORROW_PARK_ON_FAILURE==='true'?parkUntilStopped():null;console.log(JSON.stringify({status:'disabled',new_openings_allowed:false}));if(parked)await parked;return;}
 const env=process.env;
 if(env.ALPACA_LICENSE_APPROVED!=='true'||env.ALPACA_ARCHIVE_APPROVED!=='true'||!env.ALPACA_API_KEY_ID||!env.ALPACA_API_SECRET_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('server licensing or credential configuration missing');
 const budget=createAttemptBudget({directory:env.MORROW_STATE_DIR,runId:env.MORROW_STREAM_RUN_ID});
 const symbols=streamUniverse([...new Set([...(env.MORROW_SYMBOLS||'SPY,QQQ').split(',').map(s=>s.trim()),'SPY','QQQ','ADBE'])]);
 const url='https://fglbxoafbebsryjeqcbu.supabase.co';
 const resolveSymbols=alpacaAssetResolver({keyId:env.ALPACA_API_KEY_ID,secret:env.ALPACA_API_SECRET_KEY,onExcluded:async excluded=>{console.log(JSON.stringify({status:'symbols_outside_US_equity_SIP',symbols:excluded}));}});
 const loadSymbols=subscriptionLoader({url,serviceRole:env.SUPABASE_SERVICE_ROLE_KEY,seed:symbols,resolveSymbols,tiered:true});
 const store=supabaseObservationStore({url,serviceRole:env.SUPABASE_SERVICE_ROLE_KEY});
 const storeBars=supabaseObservationStore({url,serviceRole:env.SUPABASE_SERVICE_ROLE_KEY,table:'morrow_research_minute_bars'});
 const calendar=makeCalendar({keyId:env.ALPACA_API_KEY_ID,secret:env.ALPACA_API_SECRET_KEY});
 const abort=new AbortController();for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>abort.abort());
 let lastHealth={};
 const onHealth=async value=>{
  lastHealth={...lastHealth,...value};
  if(value.status==='sip_subscribed')lastHealth.reason=null;
  value={...lastHealth,status:value.status};
  if(['failed','stream_stopped_operator_review_required','sip_subscribed'].includes(value.status))console.log(JSON.stringify({at:new Date().toISOString(),...JSON.parse(healthDetail(value))}));
  const status=value.status==='observations_fresh'?'ok':['sip_subscribed','bounded_replay_complete','coverage_unknown_or_stale'].includes(value.status)?'blocked':'failed';
  const metrics=Object.fromEntries(['queue_bytes','rss_bytes','stored_records','last_write_ms','event_lag_ms','symbol_count','research_symbol_count'].filter(k=>Number.isFinite(value[k])).map(k=>[k,value[k]]));
  metrics.stale_research_symbols=(value.stale_research_symbols||[]).slice(0,500);
  const r=await fetch(`${url}/rest/v1/morrow_integration_health`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',prefer:'return=minimal'},body:JSON.stringify({dataset:'alpaca_sip',checked_at:new Date().toISOString(),status,detail:healthDetail(value),metrics,coverage:value.stale_symbols?.length?('stale_symbols:'+value.stale_symbols.join(',')).slice(0,200):value.backfill_complete===true?'bounded_replay_complete_earlier_unknown':'gap_or_unknown'})});
  if(!r.ok)throw Error('health persistence failed');
 };
 try{await supervise({beforeAttempt:()=>budget.reserve(),signal:abort.signal,onFailure:onHealth,onHeartbeat:health=>onHealth(health||{status:'coverage_unknown_or_stale'}),refreshSymbols:loadSymbols,connect:async()=>connectSip({...await loadSymbols(),keyId:env.ALPACA_API_KEY_ID,secret:env.ALPACA_API_SECRET_KEY,licensed:true,store,storeBars,calendar,onHealth})});}
 catch(error){await onHealth({status:'stream_stopped_operator_review_required'}).catch(()=>{});throw error;}
}
if(import.meta.url===new URL(process.argv[1]||'', 'file://').href)main().catch(async()=>{const parked=process.env.MORROW_PARK_ON_FAILURE==='true'?parkUntilStopped():null;console.error('Morrow SIP worker stopped; inspect readiness and server configuration.');if(parked)await parked;else process.exitCode=1;});
