import assert from 'node:assert/strict';
import test from 'node:test';
import {modelCohort} from '../server/model-route.mjs';
test('intended pin cannot certify actual execution or permit trading',()=>{
 assert.equal(modelCohort({intended_model:'gpt-5.6-sol'}).reason,'actual_route_unknown');
 assert.equal(modelCohort({actual_model:'gpt-5.4'}).eligible_for_gpt56_cohort,false);
 const receipt=modelCohort({actual_provider:'openai-codex',actual_model:'gpt-5.6-sol',actual_reasoning_effort:'high'});
 assert.equal(receipt.eligible_for_gpt56_cohort,true);assert.equal(receipt.decision_execution_allowed,false);
});
