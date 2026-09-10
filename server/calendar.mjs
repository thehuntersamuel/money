// ICU formatters allocate native memory too. Never construct them per tick.
const nyFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function nyParts(d){return Object.fromEntries(nyFormatter.formatToParts(d).map(p=>[p.type,p.value]));}
function classify(parts,days){
 const date=`${parts.year}-${parts.month}-${parts.day}`,clock=`${parts.hour}:${parts.minute}`;
 const day=days.find(row=>row.date===date);
 if(!day||!/^\d{2}:\d{2}$/.test(day.open)||!/^\d{2}:\d{2}$/.test(day.close)||day.open>=day.close)return 'unknown';
 return clock>=day.open&&clock<day.close?'regular':clock>='04:00'&&clock<'20:00'?'extended':'unknown';
}
export function sessionFromCalendar(eventAt,days) {
 const d=new Date(eventAt);if(!Number.isFinite(d.getTime())||!Array.isArray(days))return 'unknown';
 return classify(nyParts(d),days);
}
export function makeCalendar({keyId,secret,fetchImpl=fetch}) {
 const cache=new Map(),minutes=new Map(),loading=new Map();
 return async eventAt=>{
  if(!keyId||!secret)throw new Error('secure calendar credentials required');
  const d=new Date(eventAt);if(!Number.isFinite(d.getTime()))return 'unknown';
  const minute=Math.floor(d.getTime()/60000);
  if(minutes.has(minute))return minutes.get(minute);
  const parts=nyParts(d),date=`${parts.year}-${parts.month}-${parts.day}`;
  if(!cache.has(date)){
   if(!loading.has(date))loading.set(date,(async()=>{
    const url=new URL('https://paper-api.alpaca.markets/v2/calendar');url.searchParams.set('start',date);url.searchParams.set('end',date);
    let response;try{response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'APCA-API-KEY-ID':keyId,'APCA-API-SECRET-KEY':secret}});}catch{throw new Error('calendar unavailable');}
    if(!response.ok)throw new Error(`calendar status ${response.status}`);
    const days=await response.json();if(!Array.isArray(days))throw new Error('invalid calendar response');
    if(cache.size>=7)cache.delete(cache.keys().next().value);cache.set(date,days);
   })().finally(()=>loading.delete(date)));
   await loading.get(date);
  }
  const session=classify(parts,cache.get(date));
  if(minutes.size>=1440)minutes.delete(minutes.keys().next().value);minutes.set(minute,session);
  return session;
 };
}
