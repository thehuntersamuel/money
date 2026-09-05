begin;
drop function if exists public.place_morrow_paper_trade(uuid, uuid, jsonb);
revoke insert on public.trade_proposals from service_role;
-- Proposal/history tables remain at their canonical names and remain readable.
-- Keep UPDATE and the repaired close RPC available for outstanding paper exits.
-- Do not rename or delete the decision ledger during capability rollback.
commit;
