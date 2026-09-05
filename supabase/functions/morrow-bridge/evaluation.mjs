// Dollar-based matched opportunity accounting. Never selects or promotes trades.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function evaluateOpportunities(rows,{fixedCosts=null,periodStart,periodEnd}={}){
 if(!Array.isArray(rows)||rows.length>10000)throw Error('bounded opportunity set required');
 if(!Number.isFinite(Date.parse(periodStart))||!Number.isFinite(Date.parse(periodEnd))||periodStart>=periodEnd)throw Error('evaluation period required');
 const seen=new Set(),eligible=[],missing=[];
 for(const r of rows){
  if(!r?.id||seen.has(r.id))throw Error('duplicate or missing opportunity ID');seen.add(r.id);
  if(r.cohort!=='paper')continue; // Shadow/rejected are reported separately, never pooled.
  const fields=['capital','gross_pnl','benchmark_pnl','cash_pnl','fees','slippage'];
  if(fields.some(k=>!finite(r[k]))||r.capital<=0||r.fees<0||r.slippage<0||!r.receipt_id||r.baseline_exposure_matched!==true||!r.matured_at||Date.parse(r.matured_at)>Date.parse(periodEnd)||!r.entry_at||!r.exit_at||Date.parse(r.entry_at)<Date.parse(periodStart)||Date.parse(r.exit_at)>Date.parse(periodEnd)||Date.parse(r.exit_at)<Date.parse(r.entry_at)||![r.matured_at,r.entry_at,r.exit_at].every(x=>Number.isFinite(Date.parse(x)))){
   missing.push({id:r.id,reason:'incomplete_or_unmatched_opportunity'});continue;
  }
  eligible.push({...r,net:r.gross_pnl-r.fees-r.slippage,excess:r.gross_pnl-r.fees-r.slippage-r.benchmark_pnl});
 }
 const sum=k=>eligible.reduce((a,r)=>a+r[k],0);const fixedKnown=finite(fixedCosts)&&fixedCosts>=0;
 const best=eligible.length?Math.max(...eligible.map(r=>r.excess)):null;
 return {units:'USD',period_start:periodStart,period_end:periodEnd,paper_opportunities:eligible.length,missing,shadow_count:rows.filter(r=>r.cohort==='shadow').length,rejected_count:rows.filter(r=>r.cohort==='rejected').length,
  gross_pnl:eligible.length?sum('gross_pnl'):null,transaction_costs:eligible.length?sum('fees')+sum('slippage'):null,
  matched_benchmark_pnl:eligible.length?sum('benchmark_pnl'):null,matched_cash_pnl:eligible.length?sum('cash_pnl'):null,
  fixed_costs:fixedKnown?fixedCosts:null,net_active_result:eligible.length&&fixedKnown&&!missing.length?sum('net')-fixedCosts:null,
  benchmark_excess:eligible.length&&fixedKnown&&!missing.length?sum('excess')-fixedCosts:null,
  best_opportunity_removed:eligible.length>1&&fixedKnown&&!missing.length?sum('excess')-best-fixedCosts:null,
  drawdown:null,drawdown_reason:'requires marked portfolio equity curve, not summed trade exits',
  uncertainty:'descriptive accounting; correlated opportunities are not independent statistical evidence',promotion_allowed:false};
}
export function markedDrawdown(points){
 if(!Array.isArray(points)||points.length<2)return null;
 let peak=0,worst=0,last=-Infinity;
 for(const p of points){const t=Date.parse(p.at);if(!Number.isFinite(t)||t<=last||!finite(p.equity)||p.equity<=0||p.external_flow!==0)return null;last=t;peak=Math.max(peak,p.equity);worst=Math.max(worst,(peak-p.equity)/peak);}
 return worst;
}
