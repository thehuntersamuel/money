begin;

-- Append-only observations are server-only until display/retention rights are verified.
create table public.morrow_market_observations (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique check(length(source_id) between 1 and 200),
  symbol text not null check(symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  provider text not null check(provider='alpaca'),
  feed text not null check(feed='sip'),
  event_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  session text not null check(session in ('regular','extended','unknown')),
  bid numeric, ask numeric, last numeric,
  gap boolean not null default true,
  is_test boolean not null default true,
  check(event_at <= received_at + interval '5 seconds'),
  check(bid is null or (bid>0 and bid::text not in ('NaN','Infinity','-Infinity'))),
  check(ask is null or (ask>0 and ask::text not in ('NaN','Infinity','-Infinity'))),
  check(last is null or (last>0 and last::text not in ('NaN','Infinity','-Infinity'))),
  check(bid is null or ask is null or bid<=ask)
);
create index morrow_observations_symbol_time on public.morrow_market_observations(symbol,event_at desc);
alter table public.morrow_market_observations enable row level security;
revoke all on public.morrow_market_observations from public,anon,authenticated;
grant select,insert on public.morrow_market_observations to service_role;
create trigger immutable_observation before update or delete on public.morrow_market_observations
for each row execute function public.morrow_receipt_immutable();

create table public.morrow_trigger_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.trade_proposals(id),
  observation_id uuid not null references public.morrow_market_observations(id),
  thesis_version integer not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(proposal_id,thesis_version)
);
alter table public.morrow_trigger_events enable row level security;
revoke all on public.morrow_trigger_events from public,anon,authenticated;
grant select on public.morrow_trigger_events to authenticated;
grant select,insert on public.morrow_trigger_events to service_role;
create policy owner_select on public.morrow_trigger_events for select to authenticated using(public.is_owner());
create trigger immutable_trigger_event before update or delete on public.morrow_trigger_events
for each row execute function public.morrow_receipt_immutable();

create or replace function public.morrow_capture_crossing() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  -- A historical touch is evidence for review, never a fill or qualification.
  -- Unknown sessions and unbounded/missing coverage cannot silently qualify.
  if new.is_test or new.session='unknown' or new.last is null then return new; end if;
  insert into public.morrow_trigger_events(proposal_id,observation_id,thesis_version,observed_at)
  select p.id,new.id,p.thesis_version,new.event_at
  from public.trade_proposals p join public.paper_books b on b.id=p.book_id
  where b.label='Robinhood Savings' and p.state='watch' and p.decision='wait_for_trigger'
    and p.symbol=new.symbol and new.event_at >= p.last_researched_at
    and ((p.trigger_direction='above' and new.last>=p.trigger_price)
      or (p.trigger_direction='below' and new.last<=p.trigger_price))
  on conflict(proposal_id,thesis_version) do nothing;
  return new;
end; $$;
revoke all on function public.morrow_capture_crossing() from public,anon,authenticated;
create trigger capture_crossing after insert on public.morrow_market_observations
for each row execute function public.morrow_capture_crossing();

create table public.morrow_proposal_history (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null, book_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  snapshot jsonb not null
);
alter table public.morrow_proposal_history enable row level security;
revoke all on public.morrow_proposal_history from public,anon,authenticated;
grant select on public.morrow_proposal_history to authenticated;
grant select,insert on public.morrow_proposal_history to service_role;
create policy owner_select on public.morrow_proposal_history for select to authenticated using(public.is_owner());
create trigger immutable_proposal_history before update or delete on public.morrow_proposal_history
for each row execute function public.morrow_receipt_immutable();
create function public.morrow_preserve_proposal() returns trigger language plpgsql security invoker
set search_path=public,pg_temp as $$ begin
 if tg_op='UPDATE' then
  insert into public.morrow_proposal_history(proposal_id,book_id,snapshot) values(old.id,old.book_id,to_jsonb(old));
 end if;
 insert into public.morrow_proposal_history(proposal_id,book_id,snapshot) values(new.id,new.book_id,to_jsonb(new));
 return new;
end; $$;
revoke all on function public.morrow_preserve_proposal() from public,anon,authenticated;
create trigger preserve_proposal after insert or update on public.trade_proposals
for each row execute function public.morrow_preserve_proposal();

-- Prevent direct UI mutations from bypassing the repair/readiness gates.
-- This rollout intentionally leaves new Savings openings disabled at the DB boundary.
create function public.morrow_trade_guard() returns trigger language plpgsql security invoker
set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
  if new.status='open' and exists(select 1 from public.paper_books b where b.id=new.book_id and b.label='Robinhood Savings') then
   raise exception 'Morrow openings blocked until verified readiness and champion activation';
  end if;
  return new;
 end if;
 if exists(select 1 from public.morrow_close_receipts r where r.trade_id=old.id) then
  raise exception 'Canonical closed trade is immutable; preserve corrections as separate records';
 end if;
 if exists(select 1 from public.trade_proposals p where p.trade_id=old.id) and current_user not in ('service_role','postgres') then
  raise exception 'Linked Morrow trades require the authenticated paper bridge';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function public.morrow_trade_guard() from public,anon,authenticated;
create trigger morrow_trade_guard before insert or update or delete on public.trades
for each row execute function public.morrow_trade_guard();

commit;
