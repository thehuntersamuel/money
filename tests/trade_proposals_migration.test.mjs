import assert from 'node:assert/strict';
import fs from 'node:fs';

const forwardPath = new URL('../supabase/migrations/20260830000000_morrow_trade_proposals.sql', import.meta.url);
const rollbackPath = new URL('../supabase/rollbacks/20260830000000_morrow_trade_proposals.rollback.sql', import.meta.url);
const closeForwardPath = new URL('../supabase/migrations/20260830020000_morrow_trade_close_lifecycle.sql', import.meta.url);
const closeRollbackPath = new URL('../supabase/rollbacks/20260830020000_morrow_trade_close_lifecycle.rollback.sql', import.meta.url);
assert.equal(fs.existsSync(forwardPath), true, 'forward migration must exist');
assert.equal(fs.existsSync(rollbackPath), true, 'rollback migration must exist');
assert.equal(fs.existsSync(closeForwardPath), true, 'close lifecycle migration must exist');
assert.equal(fs.existsSync(closeRollbackPath), true, 'close lifecycle rollback must exist');

const sql = fs.readFileSync(forwardPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');
const closeSql = fs.readFileSync(closeForwardPath, 'utf8');
const closeRollback = fs.readFileSync(closeRollbackPath, 'utf8');
assert.match(sql, /create table public\.trade_proposals/i);
assert.match(sql, /unique\s*\(book_id,\s*proposal_key\)/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /create policy owner_select[\s\S]*for select to authenticated[\s\S]*is_owner\(\)/i);
assert.match(sql, /grant select on public\.trade_proposals to authenticated/i);
assert.match(sql, /revoke insert, update, delete on public\.trade_proposals from authenticated/i);
assert.doesNotMatch(sql, /grant select, insert, update, delete on public\.trade_proposals to authenticated/i);
assert.match(sql, /evidence jsonb/i);
assert.match(sql, /jsonb_typeof\(evidence\) = 'array'/i);
assert.match(sql, /news_checked_at timestamptz not null/i);
assert.match(sql, /source_evidence_hash text not null/i);
assert.match(sql, /trigger_status/i);
assert.match(sql, /trade_id uuid references public\.trades/i);
assert.match(sql, /constraint trade_proposals_state_decision_check/i);
assert.match(sql, /create or replace function public\.place_morrow_paper_trade\s*\(\s*p_book_id uuid,\s*p_proposal_id uuid,\s*p_trade jsonb\s*\)/i);
const rpcSource = sql.slice(
  sql.search(/create or replace function public\.place_morrow_paper_trade/i),
  sql.search(/revoke all on function public\.place_morrow_paper_trade/i),
);
assert.match(rpcSource, /security invoker/i, 'the trade RPC must preserve caller privileges');
assert.match(rpcSource, /pg_advisory_xact_lock[\s\S]*p_book_id/i, 'trade concurrency must serialize per book');
assert.match(rpcSource, /from public\.paper_books[\s\S]*for update/i, 'the book row must be locked');
assert.match(rpcSource, /from public\.trade_proposals[\s\S]*for update/i, 'the qualified proposal must be locked');
assert.match(rpcSource, /state <> 'qualified'/i);
assert.match(rpcSource, /source_freshness <> 'fresh'/i);
assert.match(rpcSource, /interval '6 hours'/i);
assert.match(rpcSource, /v_proposal\.symbol <> v_symbol/i);
assert.match(rpcSource, /status = 'open'[\s\S]*>= 3/i);
assert.match(rpcSource, /america\/new_york/i, 'the daily limit must use the New York trading date');
assert.match(rpcSource, /opened_on = v_trading_date[\s\S]*>= 1/i);
assert.match(rpcSource, /v_planned_loss > v_equity \* 0\.005/i);
assert.match(rpcSource, /v_existing_risk \+ v_planned_loss > v_equity \* 0\.01/i);
assert.match(rpcSource, /v_cost > v_buying_power/i);
assert.match(rpcSource, /v_reward_risk < 1\.5/i);
assert.match(rpcSource, /insert into public\.trades/i);
assert.match(rpcSource, /update public\.trade_proposals[\s\S]*state = 'opened'[\s\S]*decision = 'paper_executed'/i);
const lockIndex = rpcSource.search(/pg_advisory_xact_lock/i);
const countIndex = rpcSource.search(/status = 'open'/i);
const insertIndex = rpcSource.search(/insert into public\.trades/i);
assert.ok(lockIndex >= 0 && lockIndex < countIndex && countIndex < insertIndex, 'locking must precede concurrency checks and insertion');
assert.match(rpcSource, /get diagnostics v_verified_count = row_count[\s\S]*v_verified_count <> 1/i, 'the RPC must verify exactly one linked result');
assert.match(sql, /revoke all on function public\.place_morrow_paper_trade\(uuid, uuid, jsonb\) from public, anon, authenticated/i);
assert.match(sql, /grant execute on function public\.place_morrow_paper_trade\(uuid, uuid, jsonb\) to service_role/i);
assert.match(rollback, /drop function if exists public\.place_morrow_paper_trade\(uuid, uuid, jsonb\)/i);
assert.doesNotMatch(rollback, /drop table if exists public\.trade_proposals/i, 'rollback must preserve proposal history');

assert.match(closeSql, /create or replace function public\.close_morrow_paper_trade\s*\(\s*p_book_id uuid,\s*p_trade_id uuid,\s*p_exit_price numeric,\s*p_close_note text\s*\)/i);
const closeRpcSource = closeSql.slice(
  closeSql.search(/create or replace function public\.close_morrow_paper_trade/i),
  closeSql.search(/revoke all on function public\.close_morrow_paper_trade/i),
);
assert.match(closeRpcSource, /security invoker/i);
assert.match(closeRpcSource, /pg_advisory_xact_lock[\s\S]*p_book_id/i);
assert.match(closeRpcSource, /from public\.paper_books[\s\S]*for update/i);
assert.match(closeRpcSource, /from public\.trades[\s\S]*for update/i);
assert.match(closeRpcSource, /from public\.trade_proposals[\s\S]*where proposal\.trade_id = v_trade\.id[\s\S]*for update/i);
assert.doesNotMatch(closeRpcSource, /where proposal\.trade_id = v_trade\.id\s+and proposal\.book_id = p_book_id[\s\S]*for update/i, 'proposal lookup must not hide an inconsistent linked book');
assert.match(closeRpcSource, /v_proposal_book_id <> p_book_id[\s\S]*linked proposal book does not match trade book/i);
assert.match(closeRpcSource, /update public\.trades[\s\S]*status = 'closed'/i);
assert.match(closeRpcSource, /update public\.trade_proposals[\s\S]*state = 'closed'[\s\S]*decision = 'closed'/i);
assert.match(closeRpcSource, /where linked\.trade_id = v_trade\.id[\s\S]*state = 'opened'/i);
assert.match(closeSql, /exit_price numeric[\s\S]*close_note text[\s\S]*closed_on date[\s\S]*updated_at timestamptz[\s\S]*proposal_decision text/i);
assert.match(closeRpcSource, /select v_trade\.id[\s\S]*v_trade\.exit_price[\s\S]*v_trade\.close_note[\s\S]*v_trade\.closed_on[\s\S]*v_trade\.updated_at[\s\S]*v_proposal_decision/i);
assert.match(closeRpcSource, /get diagnostics v_verified_count = row_count[\s\S]*v_verified_count <> 1/i);
assert.match(closeSql, /create unique index if not exists trade_proposals_trade_id_unique_idx[\s\S]*on public\.trade_proposals \(trade_id\)[\s\S]*where trade_id is not null/i);
assert.match(closeSql, /revoke all on function public\.close_morrow_paper_trade\(uuid, uuid, numeric, text\) from public, anon, authenticated/i);
assert.match(closeSql, /grant execute on function public\.close_morrow_paper_trade\(uuid, uuid, numeric, text\) to service_role/i);
assert.match(closeRollback, /drop function if exists public\.close_morrow_paper_trade\(uuid, uuid, numeric, text\)/i);

console.log('trade proposals migration and rollback contract passed');

assert.doesNotMatch(rollback, /alter table.*rename/i, 'rollback preserves canonical history reads');
assert.match(closeRollback, /paper exposure remains/i);
