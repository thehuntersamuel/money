// Run only in an approved persistent SERVER runtime, never as a Morrow reasoning job.
import {connectSip,supabaseObservationStore} from './ingestion.mjs';
import {makeCalendar} from './calendar.mjs';
import {universe} from './market-data.mjs';
export async function supervise({connect,signal,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxAttempts=5,onFailure=()=>{},onHeartbeat=async()=>{}}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw Error('reconnect budget must be 1-5');
 for(let attempt=0;attempt<maxAttempts&&!signal.aborted;attempt++){
  let worker;
  try{
   worker=await connect();
   // Allow subscription/replay handshake. Missing health never becomes ready by default.
   for(let i=0;i<60&&!signal.aborted&&!worker.isHealthy();i++)await sleep(1000);
   const connected=()=>worker.isConnected?worker.isConnected():worker.isHealthy();
   let ticks=0;
   while(!signal.aborted&&connected()){await sleep(1000);await worker.drain();const health=worker.checkHealth?await worker.checkHealth():null;if(++ticks%30===0)await onHeartbeat(health);}
   if(signal.aborted)return {stopped:true};
  }catch{onFailure({reason:'connection_or_persistence_failure',attempt:attempt+1});}
  finally{worker?.stop();if(worker)await worker.drain().catch(()=>{});}
  if(attempt+1<maxAttempts&&!signal.aborted)await sleep(Math.min(30000,1000*2**attempt));
 }
 if(signal.aborted)return {stopped:true};
 throw Error('SIP reconnect budget exhausted; operator review required');
}
async function main(){
 if(process.env.MORROW_INGEST_ENABLED!=='true'){console.log(JSON.stringify({status:'disabled',new_openings_allowed:false}));return;}
 const env=process.env;
 if(env.ALPACA_LICENSE_APPROVED!=='true'||!env.ALPACA_API_KEY_ID||!env.ALPACA_API_SECRET_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('server licensing or credential configuration missing');
 const symbols=universe((env.MORROW_SYMBOLS||'SPY').split(',').map(s=>s.trim()));
 const url='https://fglbxoafbebsryjeqcbu.supabase.co';
 const store=supabaseObservationStore({url,serviceRole:env.SUPABASE_SERVICE_ROLE_KEY});
 const calendar=makeCalendar({keyId:env.ALPACA_API_KEY_ID,secret:env.ALPACA_API_SECRET_KEY});
 const abort=new AbortController();for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>abort.abort());
 const onHealth=async value=>{
  const status=value.status==='observations_fresh'?'ok':['sip_subscribed','bounded_replay_complete','coverage_unknown_or_stale'].includes(value.status)?'blocked':'failed';
  const r=await fetch(`${url}/rest/v1/morrow_integration_health`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',prefer:'return=minimal'},body:JSON.stringify({dataset:'alpaca_sip',checked_at:new Date().toISOString(),status,detail:JSON.stringify({status:value.status,event_at:value.last_event_at||null,persisted_at:value.last_persisted_at||null,session:value.session||'unknown'}).slice(0,200),coverage:value.stale_symbols?.length?('stale_symbols:'+value.stale_symbols.join(',')).slice(0,200):value.backfill_complete===true?'bounded_replay_complete_earlier_unknown':'gap_or_unknown'})});
  if(!r.ok)throw Error('health persistence failed');
 };
 await supervise({signal:abort.signal,onHeartbeat:health=>onHealth(health||{status:'coverage_unknown_or_stale'}),connect:()=>connectSip({symbols,keyId:env.ALPACA_API_KEY_ID,secret:env.ALPACA_API_SECRET_KEY,licensed:true,store,calendar,onHealth})});
}
if(import.meta.url===new URL(process.argv[1]||'', 'file://').href)main().catch(()=>{console.error('Morrow SIP worker stopped; inspect readiness and server configuration.');process.exitCode=1;});
