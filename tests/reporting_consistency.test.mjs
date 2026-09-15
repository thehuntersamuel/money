import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('function mergedResearchView('),html.indexOf('function providerPresentation('));
const {mergedResearchView,runPresentation}=runInNewContext(code+';({mergedResearchView,runPresentation})');
const proposal={id:'p1',book_id:'book',proposal_key:'PLAY:v1',symbol:'PLAY',state:'rejected',last_researched_at:'2026-09-15T13:47:49Z',updated_at:'2026-09-15T13:54:25Z',thesis:'TEST review',rejection_reason:'TEST rejection',evidence:[{url:'https://example.com/filing',title:'TEST source',retrieved_at:'2026-09-15T13:47:00Z'}]};
test('fresh proposal appears in research with sources even if the separate ledger is missing',()=>{
 const r=mergedResearchView([], [proposal,{...proposal,id:'other',book_id:'other'}],'book');
 assert.equal(r.decisions.length,1);assert.equal(r.decisions[0].payload.disposition,'rejected');
 assert.equal(r.decisions[0].projection,'saved_proposal');assert.equal(r.rows.filter(x=>x.kind==='source').length,1);
 assert.equal(r.decisions[0].created_at,proposal.last_researched_at);
 assert.equal(runPresentation(r.rows,'book',Date.now()).title,'Job execution unverified');
});
test('newest review wins by proposal key without modifying or backfilling source history',()=>{
 const old={id:'d1',kind:'decision',book_id:'book',created_at:'2026-09-08T14:00:00Z',payload:{proposal_key:proposal.proposal_key,disposition:'watch'}};
 const rows=[old],before=JSON.stringify(rows);const view=mergedResearchView(rows,[proposal],'book');
 assert.equal(view.decisions.length,1);assert.equal(view.decisions[0].payload.disposition,'rejected');assert.equal(JSON.stringify(rows),before);
 const fresh={...old,created_at:'2026-09-16T14:00:00Z'};
 assert.equal(mergedResearchView([fresh],[proposal],'book').decisions[0].id,'d1');
});
test('historical failures remain visible and cannot become verified current execution',()=>{
 const row={id:'run',book_id:'book',kind:'run',created_at:'2026-09-15T14:00:00Z',payload:{finished_at:'2026-09-08T14:00:00Z',status:'blocked',blockers:['runtime_sync_blocked_by_invalid_canary_record','active_morrow_job_limit_exceeded'],actual_model:null}};
 const r=runPresentation([row],'book',Date.parse('2026-09-15T15:00:00Z'));
 assert.equal(r.stale,true);assert.equal(r.title,'Job receipts overdue');assert.match(r.note,/historical/);
 assert.equal(r.blockers.length,2);assert.match(r.blockers[0],/validation record/);assert.equal(r.payload.actual_model,null);
});
