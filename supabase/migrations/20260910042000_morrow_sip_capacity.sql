-- Additive recovery: immutable research summaries are NOT crossing authority.
create table public.morrow_research_minute_bars (
 id uuid primary key default gen_random_uuid(),
 source_id text not null unique check(length(source_id)<=200),
 symbol text not null check(symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
 provider text not null check(provider='alpaca'),
 feed text not null check(feed='sip'),
 event_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 persisted_at timestamptz not null default clock_timestamp(),
 kind text not null check(kind in ('b','u')),
 session text not null check(session in ('regular','extended','unknown')),
 open numeric not null check(open>0), high numeric not null check(high>0),
 low numeric not null check(low>0), close numeric not null check(close>0),
 volume numeric not null check(volume>=0),
 is_test boolean not null default true,
 check(low<=least(open,close) and high>=greatest(open,close))
);
create index morrow_research_bars_symbol_time on public.morrow_research_minute_bars(symbol,event_at desc,received_at desc);
alter table public.morrow_research_minute_bars enable row level security;
revoke all on public.morrow_research_minute_bars from public,anon,authenticated;
grant select,insert on public.morrow_research_minute_bars to service_role;
create trigger immutable_research_bar before update or delete on public.morrow_research_minute_bars
 for each row execute function public.morrow_receipt_immutable();
comment on table public.morrow_research_minute_bars is 'Research-only SIP minute summaries and immutable revisions; never trigger-order, crossing, or fill authority. No bar backfill completeness is implied.';
-- Existing rows retain NULL: their historical insertion time is not invented.
alter table public.morrow_market_observations add column persisted_at timestamptz;
alter table public.morrow_market_observations alter column persisted_at set default clock_timestamp();
comment on column public.morrow_market_observations.persisted_at is 'Database insertion time for new receipts; NULL on legacy receipts. Distinct from provider event_at and worker received_at.';
alter table public.morrow_integration_health add column metrics jsonb not null default '{}'::jsonb
 check(jsonb_typeof(metrics)='object' and octet_length(metrics::text)<=16000);
-- Preserve existing view columns/order; append metrics without dropping access.
create or replace view public.morrow_latest_integration_health with (security_invoker=true) as
 select distinct on(dataset) dataset,checked_at,status,detail,coverage,metrics
 from public.morrow_integration_health order by dataset,checked_at desc,id desc;
create index morrow_watch_crossing_lookup on public.trade_proposals(symbol,last_researched_at)
 where state='watch' and decision='wait_for_trigger';
