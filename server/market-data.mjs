// Server-only adapters. No order, account mutation, or transfer routes exist.
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
export const SIP_STREAM = 'wss://stream.data.alpaca.markets/v2/sip';
export function universe(symbols) {
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > 30 || symbols.some(s=>!SYMBOL.test(s))) throw new Error('bounded universe of 1–30 symbols required');
  return [...new Set(symbols)];
}
function positive(x) { return typeof x==='number' && Number.isFinite(x) && x>0 ? x : null; }
function time(x) { if(typeof x!=='string' || !/(Z|[+-]\d{2}:\d{2})$/.test(x) || !Number.isFinite(Date.parse(x))) throw new Error('provider event timestamp unavailable'); return x; }
export function normalizeTrade(symbol, row, {receivedAt, session='unknown', gap=true, isTest=true}={}) {
  universe([symbol]); time(receivedAt); time(row.t);
  if(!positive(row.p) || row.i == null || !['regular','extended','unknown'].includes(session) || Date.parse(row.t)>Date.parse(receivedAt)+5000) throw new Error('invalid trade observation');
  return {source_id:`alpaca:sip:${symbol}:${row.t}:${row.i}`,symbol,provider:'alpaca',feed:'sip',event_at:row.t,received_at:receivedAt,session,bid:null,ask:null,last:row.p,gap:gap!==false,is_test:isTest!==false};
}
export function paperFill(quote, {side,qty,now,maximumAgeMs=15000}) {
  if(side!=='buy' && side!=='sell') throw new Error('invalid paper side');
  if(!positive(qty) || quote.feed!=='sip' || quote.gap!==false || quote.session!=='regular') throw new Error('paper fill unavailable');
  const age=Date.parse(now)-Date.parse(quote.event_at);
  const price=positive(side==='buy'?quote.ask:quote.bid), size=positive(side==='buy'?quote.ask_size:quote.bid_size);
  if(!Number.isFinite(age)||age<0||age>maximumAgeMs||!price||!size||qty>size||!positive(quote.bid)||!positive(quote.ask)||quote.bid>quote.ask) throw new Error('fresh executable quote/size unavailable');
  return {price,qty,observed_at:quote.event_at,assumption:'Displayed executable side; simulated, not a guaranteed fill',source_id:quote.source_id};
}
export function makeMarketData({keyId,secret,licensed=false,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  async function request(path,params) {
    if(!licensed) throw new Error('licensing approval required');
    if(!keyId||!secret) throw new Error('secure provider credentials unavailable');
    if(!['/v2/stocks/trades','/v2/stocks/quotes/latest'].includes(path)) throw new Error('route not permitted');
    const url=new URL(path,'https://data.alpaca.markets');
    for(const [key,value] of Object.entries({...params,feed:'sip'})) if(value!=null) url.searchParams.set(key,String(value));
    for(let attempt=0;attempt<3;attempt++) {
      let res;
      try {res=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'APCA-API-KEY-ID':keyId,'APCA-API-SECRET-KEY':secret}});} catch {throw new Error('Alpaca network failure; coverage remains unknown');}
      if(res.ok) return res.json();
      if((res.status===429||res.status>=500)&&attempt<2) {await sleep(Math.min(5000,Math.max(250,Number(res.headers.get('retry-after'))*1000||500*2**attempt)));continue;}
      // Never log upstream bodies, URLs containing secrets, or request headers.
      throw new Error(`Alpaca status ${res.status}; SIP entitlement/data unavailable`);
    }
  }
  return {
    latestQuotes: symbols=>request('/v2/stocks/quotes/latest',{symbols:universe(symbols).join(',')}),
    async backfillTrades(symbols,start,end,{maxPages=20}={}) {
      time(start);time(end);universe(symbols);
      if(Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>3600000||maxPages<1||maxPages>20) throw new Error('bounded backfill interval required');
      const records=[];let page_token;const seen=new Set();
      for(let i=0;i<maxPages;i++) {
        const body=await request('/v2/stocks/trades',{symbols:symbols.join(','),start,end,sort:'asc',limit:10000,page_token});
        if(!body.trades||typeof body.trades!=='object') throw new Error('malformed backfill response');
        for(const [symbol,rows] of Object.entries(body.trades)) {
          if(!symbols.includes(symbol)||!Array.isArray(rows)) throw new Error('unexpected backfill symbol/data');
          records.push(...rows.map(row=>({symbol,row})));
        }
        if(!body.next_page_token) return {records,coverage_complete:true,start,end};
        if(seen.has(body.next_page_token)) throw new Error('repeated backfill cursor; coverage unknown');
        seen.add(body.next_page_token);page_token=body.next_page_token;
      }
      return {records,coverage_complete:false,start,end,reason:'page_budget_exhausted'};
    }
  };
}
export function normalizeTiingoEod(symbol,row,retrievedAt) {
  universe([symbol]);time(retrievedAt);time(row.date);
  return {symbol,provider:'tiingo',observed_at:row.date,retrieved_at:retrievedAt,
    raw_close:positive(row.close),adjusted_close:positive(row.adjClose),
    dividend:typeof row.divCash==='number'&&Number.isFinite(row.divCash)?row.divCash:null,
    split_factor:positive(row.splitFactor),adjustment_version:retrievedAt,
    use:'independent EOD research; not consolidated crossing or fill authority'};
}
