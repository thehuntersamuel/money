import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function researchDecisionHTML('),html.indexOf('function updateThemeLabel('));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const render=runInNewContext(source+';researchDecisionHTML',{esc,URL});
test('watch research renders without invented order fields and shows missing inputs and sources',()=>{
 const r={id:'decision1',book_id:'book',payload:{symbol:'ADBE',disposition:'watch',thesis:'Wait for results',missing_data:['Tiingo unavailable'],source_ids:['s1','missing']}};
 const output=render(r,[{id:'s1',book_id:'book',kind:'source',payload:{url:'https://www.adobe.com/investor-relations.html',title:'Adobe',retrieved_at:'2026-09-09T01:25:00Z'}}]);
 assert.match(output,/Watching · research only/);assert.match(output,/Tiingo unavailable/);assert.match(output,/https:\/\/www.adobe.com/);assert.match(output,/outside the loaded history/);assert.doesNotMatch(output,/entry_price|undefined|NaN/);
});
test('source URLs and payload text cannot inject markup or cross book boundaries',()=>{
 const r={id:'x',book_id:'book',payload:{symbol:'<img src=x>',thesis:'<script>bad</script>',source_ids:['s1','s2']}};
 const output=render(r,[{id:'s1',book_id:'book',kind:'source',payload:{url:'javascript:alert(1)',title:'Unsafe'}},{id:'s2',book_id:'other',kind:'source',payload:{url:'https://example.com',title:'Private'}}]);
 assert.doesNotMatch(output,/<script>|<img|javascript:|Private/);assert.match(output,/&lt;script&gt;/);
});
