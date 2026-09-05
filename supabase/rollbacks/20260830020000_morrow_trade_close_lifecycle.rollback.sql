begin;
-- Never disable an exit path while paper exposure remains.
do $$ begin
 if exists(select 1 from public.trades t join public.paper_books b on b.id=t.book_id
           where b.label='Robinhood Savings' and t.is_real=false and t.status='open') then
  raise exception 'Keep close capability active while paper exposure remains';
 end if;
end $$;
revoke insert on public.morrow_market_observations from service_role;
drop trigger if exists capture_crossing on public.morrow_market_observations;
drop function if exists public.close_morrow_paper_trade(uuid, uuid, numeric, text);
-- Retain all receipts, observations, event IDs, history, unique links, RLS and
-- opening guards. Restoring a previous Edge Function must not reopen entries.
commit;
