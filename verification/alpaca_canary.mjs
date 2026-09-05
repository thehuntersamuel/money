// Fixed-route, read-only entitlement check. Never returns credentials or quote prices.
export async function checkAlpaca({env,fetchImpl=fetch,now=()=>Date.now()}){
 const key=env('ALPACA_API_KEY_ID'),secret=env('ALPACA_API_SECRET_KEY');
 const result={checked_at:new Date(now()).toISOString(),credentials_present:{key:!!key,secret:!!secret},ingestion_enabled:env('MORROW_INGEST_ENABLED')==='true',new_orders:0,provider_data_persisted:false};
 if(!key||!secret)return {...result,status:'missing_credentials'};
 const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
 async function get(url){
  try{
   const r=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!r.ok)return {http_status:r.status};
   const text=await r.text();if(text.length>100000)return {http_status:r.status,error:'response_too_large'};
   return {http_status:r.status,data:JSON.parse(text)};
  }catch{return {http_status:null,error:'request_failed'};}
 }
 const [sip,clock]=await Promise.all([get('https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY&feed=sip'),get('https://paper-api.alpaca.markets/v2/clock')]);
 const snap=sip.data?.SPY,q=snap?.latestQuote,t=snap?.latestTrade;
 const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now()+5000;
 result.sip={http_status:sip.http_status,requested_feed:'sip',symbol:'SPY',snapshot_present:!!snap,quote_valid:!!q&&Number.isFinite(q.bp)&&Number.isFinite(q.ap)&&q.bp>0&&q.ap>=q.bp&&validTime(q.t),trade_valid:!!t&&Number.isFinite(t.p)&&t.p>0&&validTime(t.t),quote_at:validTime(q?.t)?q.t:null,trade_at:validTime(t?.t)?t.t:null};
 result.paper_clock={http_status:clock.http_status,valid:typeof clock.data?.is_open==='boolean'&&validTime(clock.data?.timestamp),market_open:typeof clock.data?.is_open==='boolean'?clock.data.is_open:null,next_open:validTime(clock.data?.next_open)?clock.data.next_open:null};
 // Future next-open is expected: separately validate only syntax, no past-time gate.
 if(typeof clock.data?.next_open==='string'&&Number.isFinite(Date.parse(clock.data.next_open)))result.paper_clock.next_open=clock.data.next_open;
 result.status=sip.http_status===200&&result.sip.quote_valid&&result.sip.trade_valid&&result.paper_clock.valid?'credentials_and_sip_verified':'check_failed';
 result.coverage='single_snapshot_only_not_continuous_stream';
 return result;
}
