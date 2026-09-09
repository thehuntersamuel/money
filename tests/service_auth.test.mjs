import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {authorizeIngestion} from '../supabase/functions/morrow-data/service-auth.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const jwt=claims=>'e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
test('current service credential remains accepted and missing configuration fails closed',async()=>{
 assert.equal(await authorizeIngestion('Bearer current-secret','current-secret'),true);
 for(const h of [null,'','Basic current-secret','Bearer ','Bearer current-secret\n','Bearer wrong'])assert.equal(await authorizeIngestion(h,'current-secret'),false);
 assert.equal(await authorizeIngestion('Bearer current-secret',undefined),false);
});
test('only the exact pinned project service JWT is accepted; claims alone never suffice',async()=>{
 const good=jwt({role:'service_role',ref:'fglbxoafbebsryjeqcbu'});
 assert.equal(await authorizeIngestion('Bearer '+good,'other',hash(good)),true);
 assert.equal(await authorizeIngestion('Bearer '+good+'changed','other',hash(good)),false);
 assert.equal(await authorizeIngestion('Bearer '+good,'other'),false);
 for(const bad of [jwt({role:'anon',ref:'fglbxoafbebsryjeqcbu'}),jwt({role:'authenticated',ref:'fglbxoafbebsryjeqcbu'}),jwt({role:'service_role',ref:'different'}),'not-a-jwt'])assert.equal(await authorizeIngestion('Bearer '+bad,'other',hash(bad)),false);
});
