// Persistent reconnect allowance. One service instance per disk; stale locks fail closed.
import {mkdirSync,lstatSync,realpathSync,existsSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmdirSync} from 'node:fs';
import {resolve,isAbsolute,join} from 'node:path';
export function createAttemptBudget({directory,runId,limit=5}){
 if(!directory||!isAbsolute(directory)||!/^[-A-Za-z0-9_]{1,80}$/.test(runId||'')||!Number.isInteger(limit)||limit<1||limit>5)throw Error('persistent stream budget configuration required');
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(!lstatSync(directory).isDirectory()||realpathSync(directory)!==resolve(directory))throw Error('unsafe stream state directory');
 const state=join(directory,runId+'.json'),lock=join(directory,'.reserve-lock');
 return {reserve(){
  try{mkdirSync(lock,{mode:0o700});}catch{throw Error('stream budget locked; operator review required');}
  try{
   let count=0;
   if(existsSync(state)){
    const stat=lstatSync(state);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)throw Error('invalid stream budget state');
    const value=JSON.parse(readFileSync(state,'utf8'));
    if(value.version!==1||value.run_id!==runId||!Number.isInteger(value.attempts)||value.attempts<0||value.attempts>limit)throw Error('invalid stream budget state');
    count=value.attempts;
   }
   if(count>=limit)throw Error('persistent SIP reconnect budget exhausted; operator review required');
   const temp=join(lock,'next.json'),fd=openSync(temp,'wx',0o600);
   try{writeFileSync(fd,JSON.stringify({version:1,run_id:runId,attempts:count+1}));fsyncSync(fd);}finally{closeSync(fd);}
   renameSync(temp,state);const dirfd=openSync(directory,'r');try{fsyncSync(dirfd);}finally{closeSync(dirfd);}
   return count+1;
  }finally{
   // If a failure left a temp file, keep the lock: do not conceal incomplete state.
   try{rmdirSync(lock);}catch{}
  }
 }};
}
export function parkUntilStopped(){
 return new Promise(resolve=>{
  const timer=setInterval(()=>{},60000);
  const stop=()=>{clearInterval(timer);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);resolve();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
 });
}
