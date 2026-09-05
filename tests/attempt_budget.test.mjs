import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAttemptBudget} from '../server/attempt-budget.mjs';import {supervise} from '../server/sip-worker.mjs';
function fixture(){return mkdtempSync(join(tmpdir(),'morrow-budget-test-'));}
test('connection allowance survives process recreation and cannot be reset by restart',async()=>{
 const dir=fixture();try{
 for(let i=1;i<=5;i++)assert.equal(createAttemptBudget({directory:dir,runId:'TEST-release-1'}).reserve(),i);
 let calls=0;await assert.rejects(()=>supervise({signal:new AbortController().signal,beforeAttempt:()=>createAttemptBudget({directory:dir,runId:'TEST-release-1'}).reserve(),connect:async()=>{calls++;},sleep:async()=>{}}),/budget exhausted/);assert.equal(calls,0);
 assert.equal(createAttemptBudget({directory:dir,runId:'TEST-operator-reviewed-2'}).reserve(),1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('corrupt state and an abandoned reservation stop before provider access',()=>{
 const dir=fixture();try{
 writeFileSync(join(dir,'TEST.json'),'invalid');assert.throws(()=>createAttemptBudget({directory:dir,runId:'TEST'}).reserve());
 mkdirSync(join(dir,'.reserve-lock'));assert.throws(()=>createAttemptBudget({directory:dir,runId:'TEST'}).reserve(),/locked/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid paths and symlink state are rejected',()=>{
 const dir=fixture();try{
 assert.throws(()=>createAttemptBudget({directory:'.',runId:'TEST'}));assert.throws(()=>createAttemptBudget({directory:dir,runId:'../escape'}));
 writeFileSync(join(dir,'target'),'{}');symlinkSync(join(dir,'target'),join(dir,'TEST.json'));assert.throws(()=>createAttemptBudget({directory:dir,runId:'TEST'}).reserve(),/invalid/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('disabled hosted worker parks without configuration and shuts down cleanly',async()=>{
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,['server/sip-worker.mjs'],{env:{PATH:process.env.PATH,MORROW_PARK_ON_FAILURE:'true'},stdio:['ignore','pipe','pipe']});
 let output='';const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const timeout=setTimeout(()=>child.kill('SIGKILL'),3000);
 try{
 await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"status":"disabled"'))resolve();});child.once('close',()=>reject(Error('worker exited before parking')));});
 child.kill('SIGTERM');assert.deepEqual(await closed,{code:0,signal:null});assert.equal(JSON.parse(output).new_openings_allowed,false);
 }finally{clearTimeout(timeout);if(child.exitCode===null)child.kill('SIGKILL');}
});
