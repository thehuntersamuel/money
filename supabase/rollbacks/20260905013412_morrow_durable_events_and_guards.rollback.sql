begin;
revoke insert on public.morrow_market_observations from service_role;
drop trigger if exists capture_crossing on public.morrow_market_observations;
-- Preserve event/history/observation tables, RLS, close receipts and opening
-- guards. Keep close capability alive for outstanding paper positions.
commit;
