import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
test('all inline scripts parse as modules, queue options close correctly',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(!m[1].trim())continue;
  const r=spawnSync(process.execPath,['--input-type=module','--check'],{input:m[1],encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
 }
 assert.doesNotMatch(html,/<\/option\s+[^>]+>/);
});
