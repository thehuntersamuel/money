import {makeSec,factsKnownAt} from './research-data.mjs';
import {universe} from './market-data.mjs';
export const SOURCE_DATASETS=['tiingo_news','sec_company_map','sec_facts','bls_series','fred_vintage','primary_document'];
const time=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
async function request(url,{fetchImpl,method='GET',headers={},body}={}){
 let response;
 for(let attempt=0;attempt<3;attempt++){
  try{response=await fetchImpl(url,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('source connection unavailable');}
  if((response.status===429||response.status>=500)&&attempt<2){await response.body?.cancel();await new Promise(r=>setTimeout(r,250*2**attempt));continue;}
  break;
 }
 if(!response.ok)throw Error('source request rejected');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4000000){await reader.cancel();throw Error('source response budget exceeded');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return new TextDecoder().decode(bytes);
}
export async function fetchSource(input,{config,fetchImpl=fetch,now=()=>new Date().toISOString()}){
 const {dataset}=input,at=now();let provider,url,payload,coverage,displayAllowed=true;
 if(!SOURCE_DATASETS.includes(dataset))throw Error('unsupported source dataset');
 if(dataset==='tiingo_news'){
  if(!config.tiingoKey||!config.tiingoLicensed||!config.tiingoNewsApproved||!config.tiingoArchiveApproved)return {blocked:'Tiingo_news_entitlement_or_archive_missing'};
  const symbols=universe(input.symbols||[]);if(symbols.length>5)throw Error('news universe capped at five');
  provider='tiingo';url=new URL('https://api.tiingo.com/tiingo/news');url.searchParams.set('tickers',symbols.join(','));url.searchParams.set('limit','50');
  const raw=JSON.parse(await request(url,{fetchImpl,headers:{Authorization:`Token ${config.tiingoKey}`,Accept:'application/json'}}));
  if(!Array.isArray(raw)||raw.length>50)throw Error('news response exceeds budget');
  payload=raw.map(row=>{
   const u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid news URL');u.search='';u.hash='';
   return {source_id:'tiingo-news:'+String(row.id),url:u.href,title:String(row.title||'').slice(0,500),published_at:time(row.publishedDate)?row.publishedDate:null,crawled_at:time(row.crawlDate)?row.crawlDate:null,tickers:(row.tickers||[]).filter(s=>typeof s==='string').slice(0,30),source_type:'news_discovery',primary_verification_required:true};
  });displayAllowed=config.tiingoDisplayAllowed===true;coverage='latest_50_discovery_only';
 }else if(dataset==='sec_company_map'){
  if(!config.secUserAgent)return {blocked:'SEC_identification_missing'};
  const symbols=universe(input.symbols||[]);provider='sec';url=new URL('https://www.sec.gov/files/company_tickers.json');
  const raw=JSON.parse(await request(url,{fetchImpl,headers:{'User-Agent':config.secUserAgent,Accept:'application/json'}}));
  const records=Object.values(raw);payload={retrieved_at:at,mapping_is_current_not_historical:true,companies:symbols.map(symbol=>{
   const match=records.find(r=>r.ticker===symbol);return {symbol,cik:match?String(match.cik_str).padStart(10,'0'):null,name:match?.title||null,reason:match?null:'No SEC ticker mapping; ETF/fund identifiers require separate verification'};
  })};coverage='requested_symbols_current_mapping';
 }else if(dataset==='sec_facts'){
  if(!config.secUserAgent)return {blocked:'SEC_identification_missing'};
  if(!time(input.decision_at)||Date.parse(input.decision_at)>Date.parse(at))throw Error('past decision timestamp required');
  const sec=makeSec({userAgent:config.secUserAgent,fetchImpl});
  const submissions=await sec.submissions(input.cik),facts=await sec.companyFacts(input.cik);
  provider='sec';url=new URL('https://data.sec.gov/api/xbrl/companyfacts/CIK'+String(input.cik).padStart(10,'0')+'.json');
  payload=factsKnownAt(facts,submissions,input.decision_at);coverage=payload.coverage;
 }else if(dataset==='bls_series'){
  const ids=input.series_ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>5||ids.some(x=>typeof x!=='string'||!/^[A-Z0-9]{3,25}$/.test(x)))throw Error('bounded BLS series required');
  if(!Number.isInteger(input.start_year)||!Number.isInteger(input.end_year)||input.end_year<input.start_year||input.end_year-input.start_year>9)throw Error('BLS interval capped at ten years');
  provider='bls';url=new URL('https://api.bls.gov/publicAPI/v1/timeseries/data/');
  const raw=JSON.parse(await request(url,{fetchImpl,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seriesid:ids,startyear:String(input.start_year),endyear:String(input.end_year)})}));
  if(raw.status!=='REQUEST_SUCCEEDED')throw Error('BLS request incomplete');
  if(!Array.isArray(raw.Results?.series)||ids.some(id=>!raw.Results.series.some(r=>r.seriesID===id&&Array.isArray(r.data)&&r.data.length)))throw Error('BLS requested series missing');
  payload={series:raw.Results.series.filter(r=>ids.includes(r.seriesID)),retrieved_at:at,vintage_at:null,release_at:null,historical_decision_eligible:false};coverage='latest_revised_values_not_point_in_time';
 }else if(dataset==='fred_vintage'){
  if(!config.fredKey)return {blocked:'FRED_registration_key_missing'};
  if(!/^[A-Za-z0-9_]{1,50}$/.test(input.series_id||'')||!day(input.vintage)||!day(input.start)||!day(input.end)||input.start>input.end||!time(input.decision_at))throw Error('dated FRED request required');
  // Daily vintage precision cannot establish intraday availability. Require a prior day.
  const decisionDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.decision_at));
  if(input.vintage>=decisionDay||input.end>input.vintage||Date.parse(input.decision_at)>Date.parse(at))throw Error('vintage must precede decision day');
  provider='fred';url=new URL('https://api.stlouisfed.org/fred/series/observations');
  for(const [key,value] of Object.entries({api_key:config.fredKey,file_type:'json',series_id:input.series_id,realtime_start:input.vintage,realtime_end:input.vintage,observation_start:input.start,observation_end:input.end,limit:'1000'}))url.searchParams.set(key,value);
  const raw=JSON.parse(await request(url,{fetchImpl}));if(!Array.isArray(raw.observations)||!Number.isInteger(raw.count)||raw.count>1000||raw.count!==raw.observations.length)throw Error('FRED response incomplete');
  payload={series_id:input.series_id,vintage:input.vintage,decision_at:input.decision_at,release_time_precision:'day_only',observations:raw.observations.map(r=>({date:r.date,vintage_start:r.realtime_start,vintage_end:r.realtime_end,value:r.value==null||String(r.value).trim()===''||r.value==='.'?null:Number.isFinite(Number(r.value))?Number(r.value):null}))};coverage='requested_prior_day_vintage_only';
 }else{
  url=new URL(input.url);
  const official=['www.sec.gov','www.bls.gov','www.bea.gov','www.federalreserve.gov','home.treasury.gov','www.finra.org'];
  const approved=config.issuerHosts||[];
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!official.concat(approved).includes(url.hostname))throw Error('approved public source URL required');
  if(!config.secUserAgent)return {blocked:'operator_identification_missing'};
  const raw=await request(url,{fetchImpl,headers:{'User-Agent':config.secUserAgent,Accept:'text/html,application/xml,text/plain'}});
  provider='primary';payload={url:url.href,content_sha256:await sha(raw),retrieved_at:at,released_at:null,release_time_verified:false,excerpt:null,source_type:official.includes(url.hostname)?'regulator':'issuer',retention:'fingerprint_and_public_url_only'};
  coverage='fingerprint_only_release_time_requires_verification';
 }
 const sourceUrl=new URL(url);sourceUrl.search='';sourceUrl.hash='';
 return {provider,dataset,payload,displayAllowed,coverage,provenance:{url:sourceUrl.href,retrieved_at:at,content_sha256:await sha(JSON.stringify(payload))}};
}
