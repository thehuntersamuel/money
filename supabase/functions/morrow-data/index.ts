import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {ingestOnce} from '../../../server/data-worker.mjs';
// Service-only ingest. Morrow research jobs and browser users cannot invoke it.
Deno.serve(async request=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(request.method!=='POST')return reply(405,{error:'POST required'});
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return reply(401,{error:'unauthorized'});
 if(Deno.env.get('MORROW_INGEST_ENABLED')!=='true')return reply(200,{ok:true,status:'disabled',reason:'operator readiness activation pending'});
 try{
  const text=await request.text();if(text.length>4096)return reply(413,{error:'request too large'});
  const body=JSON.parse(text);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const get=(key)=>Deno.env.get(key);
  const config={alpacaKey:get('ALPACA_API_KEY_ID'),alpacaSecret:get('ALPACA_API_SECRET_KEY'),alpacaLicensed:get('ALPACA_LICENSE_APPROVED')==='true',alpacaDisplayAllowed:get('ALPACA_DISPLAY_APPROVED')==='true',tiingoKey:get('TIINGO_API_KEY'),tiingoLicensed:get('TIINGO_LICENSE_APPROVED')==='true',tiingoDisplayAllowed:get('TIINGO_DISPLAY_APPROVED')==='true',secUserAgent:get('SEC_USER_AGENT')};
  const result=await ingestOnce(body,{config,db});
  return reply(result.status==='failed'?503:200,{ok:result.status!=='failed',...result});
 }catch{return reply(503,{error:'ingestion unavailable; no credentials or upstream bodies logged'});}
});
