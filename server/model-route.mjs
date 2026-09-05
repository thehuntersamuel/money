// A receipt validator, not a Hermes runtime interceptor. Never changes shared fallback.
export function modelCohort(receipt) {
 const pinned=receipt?.actual_provider==='openai-codex' && receipt?.actual_model==='gpt-5.6-sol' && receipt?.actual_reasoning_effort==='high';
 return {eligible_for_gpt56_cohort:pinned,decision_execution_allowed:false,
  reason:pinned?'route matched; paper readiness still required':receipt?.actual_model?'fallback_or_route_drift':'actual_route_unknown'};
}
