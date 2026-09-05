// Stream capacity is independent from the discovery directory and REST batch size.
export function streamUniverse(values){
 if(!Array.isArray(values)||!values.length||values.some(s=>typeof s!=='string'||!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))throw Error('invalid stream symbols');
 const symbols=[...new Set(values)].sort();if(symbols.length>500)throw Error('stream capacity exceeded; no symbols silently omitted');return symbols;
}
export function subscriptionLoader({url,serviceRole,seed=['SPY','QQQ'],fetchImpl=fetch,resolveSymbols=async symbols=>symbols}){
 if(url!=='https://fglbxoafbebsryjeqcbu.supabase.co'||!serviceRole)throw Error('approved symbol store required');
 async function rows(table,query){
  const result=[];
  for(let offset=0;offset<=500;offset+=500){
   const endpoint=new URL(`/rest/v1/${table}`,url);for(const [k,v] of Object.entries({...query,select:'symbol',order:'symbol.asc',limit:'500',offset:String(offset)}))endpoint.searchParams.set(k,v);
   const r=await fetchImpl(endpoint,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:serviceRole,authorization:`Bearer ${serviceRole}`}});
   if(!r.ok)throw Error('stream universe read failed');const page=await r.json();if(!Array.isArray(page)||page.length>500)throw Error('invalid universe response');result.push(...page);if(page.length<500)return result;
  }throw Error('stream source exceeds capacity; coverage unavailable');
 }
 return async()=>{const results=await Promise.all([rows('watchlist',{}),rows('trade_proposals',{state:'in.(watch,qualified,opened)'}),rows('trades',{status:'eq.open',is_real:'eq.false'})]);return resolveSymbols(streamUniverse([...seed,...results.flat().map(r=>r.symbol)]),results[2].map(r=>r.symbol));};
}

export function alpacaAssetResolver({keyId,secret,fetchImpl=fetch,clock=()=>Date.now(),onExcluded=async()=>{}}){
 let cache=null,lastExcluded='';
 return async(symbols,required=[])=>{
  if(!cache||clock()-cache.at>300000){
   const r=await fetchImpl('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'APCA-API-KEY-ID':keyId,'APCA-API-SECRET-KEY':secret}});
   if(!r.ok)throw Error('Alpaca asset directory unavailable');const rows=await r.json();if(!Array.isArray(rows)||rows.length>100000)throw Error('invalid asset directory');
   cache={at:clock(),symbols:new Set(rows.filter(r=>r.class==='us_equity'&&r.status==='active'&&r.exchange!=='OTC').map(r=>r.symbol))};
  }
  const excluded=symbols.filter(s=>!cache.symbols.has(s));
  if(excluded.some(s=>required.includes(s)))throw Error('open paper position lacks supported SIP symbol; operator review required');
  const signature=excluded.join(',');if(signature!==lastExcluded){await onExcluded(excluded);lastExcluded=signature;}
  return streamUniverse(symbols.filter(s=>cache.symbols.has(s)));
 };
}
