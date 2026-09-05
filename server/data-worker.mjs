import {makeMarketData,normalizeTrade,universe} from './market-data.mjs';
import {makeCalendar} from './calendar.mjs';
import {makeTiingo,makeSec} from './research-data.mjs';
// One bounded server job. Continuous streaming is handled by ingestion.mjs on a
// persistent server; this job honestly reports bounded replay coverage only.
export async function ingestOnce({dataset,symbols=['SPY'],cik,start,end},{config,db,fetchImpl=fetch,now=()=>new Date().toISOString()}){
 const began=now();universe(symbols);
 if(!['alpaca_sip','tiingo_eod','sec_submissions'].includes(dataset))throw Error('unsupported ingestion dataset');
 const health={dataset,checked_at:began,status:'blocked',detail:'not configured',coverage:'unknown'};
 try{
  let payload,provider,displayAllowed=false;
  if(dataset==='alpaca_sip'){
   if(!config.alpacaKey||!config.alpacaSecret||config.alpacaLicensed!==true){health.detail='keys_or_license_missing';return health;}
   provider='alpaca';displayAllowed=config.alpacaDisplayAllowed===true;
   const until=now(),since=new Date(Date.parse(until)-300000).toISOString();
   const api=makeMarketData({keyId:config.alpacaKey,secret:config.alpacaSecret,licensed:true,fetchImpl});
   const batch=await api.backfillTrades(symbols,since,until,{maxPages:1});
   const calendar=makeCalendar({keyId:config.alpacaKey,secret:config.alpacaSecret,fetchImpl});
   const rows=[];for(const {symbol,row} of batch.records)rows.push(normalizeTrade(symbol,row,{receivedAt:now(),session:await calendar(row.t),gap:!batch.coverage_complete,isTest:false}));
   if(rows.length){const r=await db.from('morrow_market_observations').upsert(rows,{onConflict:'source_id',ignoreDuplicates:true});if(r.error)throw Error('observation persistence failed');}
   payload={start:since,end:until,symbols,record_count:rows.length,coverage_complete:batch.coverage_complete,mode:'bounded_replay_not_continuous',entitled_feed:'sip'};
   health.coverage=batch.coverage_complete?'last_five_minutes_replayed':'page_budget_gap';
  }else if(dataset==='tiingo_eod'){
   if(!config.tiingoKey||config.tiingoLicensed!==true){health.detail='keys_or_license_missing';return health;}
   if(symbols.length>5)throw Error('Tiingo job is limited to five symbols');
   provider='tiingo';displayAllowed=config.tiingoDisplayAllowed===true;
   const api=makeTiingo({token:config.tiingoKey,licensed:true,fetchImpl});payload=[];
   for(const symbol of symbols)payload.push(...await api.eod(symbol,start,end,now()));
   health.coverage='requested_EOD_interval_only';
  }else{
   if(!config.secUserAgent){health.detail='SEC_identification_missing';return health;}
   provider='sec';displayAllowed=true;
   const api=makeSec({userAgent:config.secUserAgent,fetchImpl});
   const raw=await api.submissions(cik),recent=raw.filings?.recent;
   if(!recent)throw Error('SEC submissions missing');
   payload={cik:String(cik),retrieved_at:now(),filings:(recent.accessionNumber||[]).slice(0,100).map((accession,i)=>({accession,form:recent.form?.[i],accepted_at:recent.acceptanceDateTime?.[i],filing_date:recent.filingDate?.[i],primary_document:recent.primaryDocument?.[i]}))};
   health.coverage='latest_100_accessions_only';
  }
  const result=await db.from('morrow_data_snapshots').insert({provider,dataset,received_at:now(),display_allowed:displayAllowed,payload});if(result.error)throw Error('snapshot persistence failed');
  health.status='ok';health.detail=displayAllowed?'snapshot_available':'raw_display_not_approved';return health;
 }catch{health.status='failed';health.detail='provider_or_persistence_failure';return health;}
 finally{
  const result=await db.from('morrow_integration_health').insert(health);
  if(result.error)throw Error('health receipt persistence failed');
 }
}
