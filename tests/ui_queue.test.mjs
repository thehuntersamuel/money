import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function loadProposalQueue(){'),html.indexOf('async function loadAll(){'));
test('UI loads older proposals beyond page one and exposes partial failures',async()=>{
 let pages=0,fail=false;const context={sb:{from(table){assert.equal(table,'trade_proposals');const q={select:()=>q,order:()=>q,range:async()=>{pages++;return fail?{error:{message:'TEST'}}:{data:Array.from({length:pages===1?500:1},(_,i)=>({id:pages+':'+i}))};}};return q;}}};
 vm.createContext(context);vm.runInContext(source,context);
 const all=await context.loadProposalQueue();assert.equal(all.rows.length,501);assert.equal(all.complete,true);
 fail=true;const partial=await context.loadProposalQueue();assert.equal(partial.complete,false);assert.match(partial.reason,/Refresh/);
});
