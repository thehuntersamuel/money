// Private, read-only provider gateway. No brokerage mutations or arbitrary URLs.
import {universe,makeMarketData} from './market-data.mjs';
import {makeTiingo} from './research-data.mjs';
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s));
export async function boundedBytes(response,maximum=8000000){
 if(!response.ok)throw Error(`provider status ${response.status}`);
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maximum){await reader.cancel();throw Error('provider response budget exceeded');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return bytes;
}
export async function tiingoDirectory(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let entry=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(v.getUint32(p,true)===0x06054b50){entry=v.getUint32(p+16,true);break;}}
 if(entry<0||entry+46>bytes.length||v.getUint32(entry,true)!==0x02014b50)throw Error('invalid ticker directory archive');
 const method=v.getUint16(entry+10,true),size=v.getUint32(entry+20,true),expanded=v.getUint32(entry+24,true),local=v.getUint32(entry+42,true);
 if(expanded>32000000||local+30>bytes.length||v.getUint32(local,true)!==0x04034b50||v.getUint16(entry+8,true)&1)throw Error('invalid ticker directory size');
 const begin=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);if(begin+size>bytes.length)throw Error('truncated directory');
 const compressed=bytes.slice(begin,begin+size);
 const raw=method===0?compressed:method===8?await boundedBytes(new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))),32000000):null;
 if(!raw||raw.length!==expanded)throw Error('invalid directory compression');
 const lines=new TextDecoder().decode(raw).trim().split(/\r?\n/),headers=lines.shift().replace(/^\uFEFF/,'').split(',');
 if(!headers.includes('ticker')||!headers.includes('startDate')||lines.length>250000)throw Error('unsupported directory schema or size');
 // Directory fields contain ticker/exchange/type/date values, not free-text CSV.
 const records=lines.map(line=>{const cells=line.split(',');if(cells.length!==headers.length||cells.some(c=>c.includes('"')))throw Error('unsupported directory CSV');return Object.fromEntries(headers.map((h,i)=>[h,cells[i]||null]));});
 return records.map(r=>({symbol:r.ticker,name:null,exchange:r.exchange||null,asset_type:r.assetType||null,start_date:r.startDate,end_date:r.endDate,availability:'directory_listing_requires_metadata_check'}));
}
export function makeDiscovery({config,fetchImpl=fetch,clock=()=>Date.now()}){
 const cache=new Map();
 async function request(url,headers){let r;try{r=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers});}catch{throw Error('provider unavailable');}return r;}
 async function json(url,headers){return JSON.parse(new TextDecoder().decode(await boundedBytes(await request(url,headers))));}
 return async function discover(input){
  const provider=input.provider||'alpaca',action=input.action;
  if(!['alpaca','tiingo'].includes(provider)||!['universe','search','metadata','history','quotes','news'].includes(action))throw Error('unsupported discovery operation');
  const licensed=provider==='alpaca'?config.alpacaLicensed:config.tiingoLicensed;
  const archive=provider==='alpaca'?config.alpacaArchiveApproved:config.tiingoArchiveApproved;
  const display=provider==='alpaca'?config.alpacaDisplayAllowed:config.tiingoDisplayAllowed;
  const key=provider==='alpaca'?config.alpacaKey:config.tiingoKey;
  if(!licensed||!archive||!display||!key||(provider==='alpaca'&&!config.alpacaSecret))return {status:'blocked',reason:'provider_keys_or_approved_use_missing',provider,action};
  const headers=provider==='alpaca'?{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':config.alpacaSecret}:{Authorization:`Token ${key}`,Accept:'application/json'};
  const at=new Date(clock()).toISOString();let data,coverage,next=null,source;
  if(action==='universe'||action==='search'){
   const query=String(input.query||'').trim().toLowerCase();if(query.length>100)throw Error('search too long');
   const offset=input.offset??0,limit=input.limit??100;if(!Number.isInteger(offset)||offset<0||offset>250000||!Number.isInteger(limit)||limit<1||limit>500)throw Error('invalid discovery page');
   source=provider==='alpaca'?'https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity':'https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip';
   let cached=cache.get(provider);
   if(!cached||clock()-cached.at>21600000){
    let rows;
    if(provider==='alpaca'){
     const raw=await json(source,headers);if(!Array.isArray(raw)||raw.length>100000)throw Error('invalid asset directory');
     rows=raw.filter(r=>r.class==='us_equity'&&r.status==='active'&&r.exchange!=='OTC').map(r=>({symbol:r.symbol,name:r.name,exchange:r.exchange,asset_type:r.class,availability:'provider_active_directory',tradable:r.tradable===true}));
    }else rows=await tiingoDirectory(await boundedBytes(await request(source,{}),16000000));
    rows.sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol)));cached={at:clock(),rows};cache.set(provider,cached);
   }
   const rows=cached.rows.filter(r=>!query||[r.symbol,r.name].join(' ').toLowerCase().includes(query));
   data=rows.slice(offset,offset+limit);next=offset+data.length<rows.length?offset+data.length:null;
   return {status:'ok',provider,action,data,total:rows.length,next_offset:next,retrieved_at:at,directory_retrieved_at:new Date(cached.at).toISOString(),coverage:provider==='tiingo'?'directory_includes_reserved_and_historical_symbols_verify_metadata':'active_supported_US_equities_excluding_OTC',source,read_only:true};
  }
  if(action==='news'){
   if(provider!=='tiingo')throw Error('news provider must be tiingo');
   if(!config.tiingoNewsApproved)return {status:'blocked',provider,action,reason:'news_use_not_approved'};
   const symbols=input.symbols==null?null:universe(input.symbols);const limit=input.limit??100;if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('news limit must be 1-100');
   const url=new URL('https://api.tiingo.com/tiingo/news');url.searchParams.set('limit',String(limit));url.searchParams.set('sortBy','crawlDate');
   if(symbols)url.searchParams.set('tickers',symbols.join(','));
   if(input.start!=null){if(!day(input.start)||!day(input.end)||input.end<input.start||Date.parse(input.end)-Date.parse(input.start)>31*86400000)throw Error('news window must be within 31 days');url.searchParams.set('startDate',input.start);url.searchParams.set('endDate',input.end);}
   const rows=await json(url,headers);if(!Array.isArray(rows)||rows.length>limit)throw Error('invalid news response');
   data=rows.map(r=>{const u=new URL(r.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid article URL');return {source_id:String(r.id),title:String(r.title||'').slice(0,500),url:u.href,published_at:stamp(r.publishedDate)?r.publishedDate:null,crawled_at:stamp(r.crawlDate)?r.crawlDate:null,tickers:Array.isArray(r.tickers)?r.tickers.slice(0,100):[],primary_verification_required:true};});
   source=url.href;coverage=rows.length===limit?'result_limit_reached_narrow_time_window':'returned_news_window_not_exhaustive';
  }else if(action==='metadata'){
   universe([input.symbol]);source=provider==='alpaca'?`https://paper-api.alpaca.markets/v2/assets/${encodeURIComponent(input.symbol)}`:`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(input.symbol)}`;
   const r=await json(source,headers);if(!r||typeof r!=='object'||Array.isArray(r))throw Error('invalid metadata');
   data=provider==='alpaca'?{symbol:r.symbol,name:r.name,exchange:r.exchange,status:r.status,asset_type:r.class,tradable:r.tradable===true}:{symbol:r.ticker,name:r.name,description:r.description,start_date:r.startDate,end_date:r.endDate,exchange:r.exchangeCode};coverage='requested_symbol_metadata';
  }else if(action==='quotes'){
   if(provider!=='alpaca')throw Error('consolidated quotes use alpaca');data=await makeMarketData({keyId:key,secret:config.alpacaSecret,licensed:true,fetchImpl}).latestQuotes(input.symbols);source='https://data.alpaca.markets/v2/stocks/quotes/latest';coverage='snapshot_only_check_each_event_timestamp_not_stream_coverage';
  }else{
   universe([input.symbol]);if(!day(input.start)||!day(input.end)||input.end<input.start||Date.parse(input.end)>clock()||Date.parse(input.end)-Date.parse(input.start)>366*86400000)throw Error('history interval must be a past window of at most one year; request earlier windows separately');
   if(provider==='tiingo'){data=await makeTiingo({token:key,licensed:true,fetchImpl}).eod(input.symbol,input.start,input.end,at);source=`https://api.tiingo.com/tiingo/daily/${input.symbol}/prices`;coverage='requested_daily_history_window';}
   else{
    const url=new URL('https://data.alpaca.markets/v2/stocks/bars');for(const [k,v] of Object.entries({symbols:input.symbol,start:input.start,end:input.end,timeframe:'1Day',feed:'sip',adjustment:'raw',limit:'1000'}))url.searchParams.set(k,v);
    const r=await json(url,headers);if(!r.bars||typeof r.bars!=='object'||!Array.isArray(r.bars[input.symbol]||[])||(r.bars[input.symbol]||[]).length>1000)throw Error('invalid bar response');
    if(r.next_page_token)throw Error('history page incomplete; narrow date window');data=r.bars[input.symbol]||[];source=url.href;coverage='requested_raw_daily_SIP_bars';
   }
  }
  return {status:'ok',provider,action,data,retrieved_at:at,source,coverage,read_only:true};
 };
}
