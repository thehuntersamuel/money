import {evaluateOpportunities} from './evaluation.mjs';
// Narrow server contracts. Records never authorize orders or activate a strategy.
const fields={
 source:['url','title','source_type','released_at','retrieved_at','accession','vintage','content_sha256','retention_note'],
 decision:['proposal_key','symbol','disposition','horizon','thesis','bear_case','catalyst','review_at','strategy_id','source_ids','event_ids','assumptions','missing_data','benchmark','sync_receipt_id'],
 strategy:['name','hypothesis','universe','horizon','entry_rules','exit_rules','cost_assumptions','baseline','holdout','variants_tried','promotion_criteria'],
 outcome:['decision_id','cohort','matured_at','gross_return','benchmark_return','cash_return','transaction_cost','fixed_cost','missing_reason','receipt_ids'],
 run:['job_id','started_at','finished_at','status','actual_provider','actual_model','actual_reasoning_effort','runtime_evidence_id','input_ids','output_ids','blockers'],
 evaluation:['opportunities','fixed_costs','period_start','period_end'],
 audit:['subject','status','evidence_ids','blockers','note']
};
const jobs=new Set(['0a1797b7e2e2','d4a3fe8b1946','51e4decec41b','4718bc248f30','36e97d7dbfe1','2f8a80689531','87e2acc68f2c']);
export function validateResearch({kind,idempotency_key,payload}={}) {
 if(!fields[kind]||!payload||Array.isArray(payload)||typeof payload!=='object')throw Error('invalid research record');
 if(typeof idempotency_key!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(idempotency_key))throw Error('invalid idempotency key');
 if(Object.keys(payload).some(k=>!fields[kind].includes(k)))throw Error('unsupported research field');
 const raw=JSON.stringify(payload);if(new TextEncoder().encode(raw).length>32768)throw Error('research record too large');
 const required=(...names)=>{if(names.some(k=>payload[k]==null||payload[k]===''||(Array.isArray(payload[k])&&!payload[k].length)))throw Error('required research field missing');};
 const texts=(...names)=>{for(const k of names)if(payload[k]!=null&&(typeof payload[k]!=='string'||payload[k].length>8000))throw Error('invalid research text');};
 const list=k=>{if(!Array.isArray(payload[k])||payload[k].length>100||payload[k].some(v=>typeof v!=='string'||v.length>2000))throw Error('invalid research list');};
 const time=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
 for(const [k,v] of Object.entries(payload)){
  if(k.endsWith('_at')&&v!=null&&!time(v))throw Error('timestamp requires timezone');
  if(k.endsWith('_ids'))list(k);
 }
 if(kind==='source'){
  required('url','title','source_type','retrieved_at','retention_note');texts(...fields.source);
  const u=new URL(payload.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('source URL must be public HTTPS without credentials/query/fragment');
  if(!['sec','issuer','regulator','macro','news_discovery','other_public'].includes(payload.source_type))throw Error('invalid source type');
  if(payload.content_sha256&&!/^[a-f0-9]{64}$/.test(payload.content_sha256))throw Error('invalid source hash');
  if(payload.released_at&&Date.parse(payload.released_at)>Date.parse(payload.retrieved_at))throw Error('source release follows retrieval');
 }
 if(kind==='decision'){
  required('proposal_key','symbol','disposition','horizon','thesis','bear_case','benchmark');texts('proposal_key','symbol','thesis','bear_case','catalyst','benchmark','strategy_id','sync_receipt_id');list('missing_data');
  if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(payload.symbol)||!['watch','rejected','research_qualified','shadow'].includes(payload.disposition)||!['swing','position'].includes(payload.horizon))throw Error('invalid decision classification');
  if(payload.disposition==='research_qualified'&&new Set(payload.source_ids||[]).size<2)throw Error('two primary sources required');
 }
 if(kind==='strategy'){
  required(...fields.strategy);list('universe');
  if(payload.universe.length>30||payload.universe.some(s=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))throw Error('bounded universe required');
  if(!['swing','position'].includes(payload.horizon))throw Error('separate strategy horizons');
 }
 if(kind==='run'){
  required('job_id','started_at','finished_at','status');texts('job_id','actual_provider','actual_model','actual_reasoning_effort','runtime_evidence_id');
  if(!jobs.has(payload.job_id)||!['ok','blocked','failed','no_change'].includes(payload.status)||Date.parse(payload.finished_at)<Date.parse(payload.started_at))throw Error('invalid run');
 }
 if(kind==='outcome'){
  required('decision_id','cohort');texts('decision_id','missing_reason');
  if(!['shadow','rejected','paper'].includes(payload.cohort))throw Error('invalid cohort');
  const nums=['gross_return','benchmark_return','cash_return','transaction_cost','fixed_cost'];
  if(nums.some(k=>payload[k]!=null&&(typeof payload[k]!=='number'||!Number.isFinite(payload[k]))))throw Error('outcome must be finite or null');
  if(nums.some(k=>payload[k]==null)&&!payload.missing_reason)throw Error('missing outcome reason required');
  if(payload.cohort==='paper'&&!(payload.receipt_ids||[]).length)throw Error('canonical paper receipts required');
 }
 if(kind==='evaluation'){
  if(payload.fixed_costs!==null&&(typeof payload.fixed_costs!=='number'||!Number.isFinite(payload.fixed_costs)||payload.fixed_costs<0))throw Error('fixed costs must be finite nonnegative or null');
  const result=evaluateOpportunities(payload.opportunities,{fixedCosts:payload.fixed_costs,periodStart:payload.period_start,periodEnd:payload.period_end});
  payload={...payload,result};
 }
 if(kind==='audit'){required('subject','status');texts('subject','status','note');}
 return {kind,idempotency_key,payload};
}
export function researchSummary(records,{truncated=false}={}){
 const counts={};for(const row of records)counts[row.kind]=(counts[row.kind]||0)+1;
 const last=records.find(r=>r.kind==='run');
 return {mode:'exploratory',records_in_page:counts,truncated,champion:null,evaluation_started_at:null,
  new_openings_allowed:false,providers:{alpaca:'pending_entitlement',tiingo:'pending_entitlement'},
  last_run_in_page:last?{id:last.id,recorded_at:last.created_at,...last.payload,route_verification:'reported_only_not_runtime_attested'}:null,
  roi_status:'requires_verified_exposure_matched_outcomes',sync:'server_records'};
}
