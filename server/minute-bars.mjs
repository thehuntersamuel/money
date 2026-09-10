import {createHash} from 'node:crypto';

// Research-only summaries. A bar can never stand in for a trade crossing/fill.
export function normalizeMinuteBar(row,{receivedAt,session='unknown',isTest=true}={}){
 if(!['b','u'].includes(row.T)||!/^[A-Z][A-Z0-9.-]{0,9}$/.test(row.S)||
  !Number.isFinite(Date.parse(row.t))||!Number.isFinite(Date.parse(receivedAt))||
  Date.parse(row.t)>Date.parse(receivedAt)+5000||
  !['regular','extended','unknown'].includes(session)||
  ![row.o,row.h,row.l,row.c].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||
  row.l>Math.min(row.o,row.c)||row.h<Math.max(row.o,row.c)||
  !Number.isFinite(row.v)||row.v<0)throw Error('invalid research minute bar');
 const payload={symbol:row.S,event_at:row.t,kind:row.T,open:row.o,high:row.h,low:row.l,close:row.c,volume:row.v};
 const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return {source_id:`alpaca:sip:bar:${digest}`,...payload,provider:'alpaca',feed:'sip',received_at:receivedAt,session,is_test:isTest!==false};
}
