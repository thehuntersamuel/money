begin;

create table public.trade_proposals (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.paper_books(id) on delete cascade,
  proposal_key text not null,
  owner_id text not null default 'morrow' check (owner_id = 'morrow'),
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  asset_name text not null,
  asset_type text not null check (asset_type in ('equity', 'etf')),
  state text not null check (state in ('watch', 'rejected', 'qualified', 'opened', 'expired', 'cancelled', 'closed', 'reviewed')),
  direction text not null default 'long' check (direction in ('long', 'short')),
  setup text not null check (setup in ('core', 'swing', 'catalyst', 'hedge')),
  horizon text not null check (horizon in ('short', 'long')),
  benchmark text not null,
  market_regime text,
  regime_uncertainty text,
  observed_at timestamptz not null,
  observed_price numeric not null check (observed_price > 0),
  entry_price numeric not null check (entry_price > 0),
  target_price numeric not null check (target_price > 0),
  stop_price numeric not null check (stop_price > 0),
  entry_condition text not null,
  trigger_direction text not null default 'none' check (trigger_direction in ('above', 'below', 'none')),
  trigger_price numeric check (trigger_price is null or trigger_price > 0),
  trigger_status text not null default 'inactive' check (trigger_status in ('inactive', 'watching', 'review_due', 'reviewed')),
  triggered_at timestamptz,
  last_trigger_price numeric check (last_trigger_price is null or last_trigger_price > 0),
  review_on date not null,
  suggested_quantity numeric check (suggested_quantity is null or suggested_quantity > 0),
  capital_committed numeric check (capital_committed is null or capital_committed >= 0),
  planned_loss numeric check (planned_loss is null or planned_loss >= 0),
  max_book_risk_pct numeric check (max_book_risk_pct is null or (max_book_risk_pct > 0 and max_book_risk_pct <= 0.5)),
  reward_risk numeric check (reward_risk is null or reward_risk >= 1.5),
  remaining_buying_power numeric,
  thesis text not null,
  bull_case text not null,
  bear_case text not null,
  catalyst text not null,
  invalidation text not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  source_freshness text not null check (source_freshness in ('fresh', 'stale', 'unknown')),
  news_checked_at timestamptz not null,
  assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(assumptions) = 'array'),
  unresolved_claims jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved_claims) = 'array'),
  counter_thesis_result text,
  confidence integer not null check (confidence between 1 and 100),
  confidence_change text,
  expected_benchmark_edge text,
  decision text not null check (decision in ('wait_for_trigger', 'rejected', 'qualified', 'paper_executed', 'expired', 'cancelled', 'closed', 'reviewed')),
  rejection_reason text,
  source_evidence_hash text not null check (source_evidence_hash ~ '^[a-f0-9]{64}$'),
  thesis_version integer not null default 1 check (thesis_version >= 1),
  last_researched_at timestamptz not null,
  trade_id uuid references public.trades(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, proposal_key),
  constraint trade_proposals_state_decision_check check (
    (state = 'watch' and decision = 'wait_for_trigger' and trigger_direction <> 'none' and trade_id is null)
    or (state = 'rejected' and decision = 'rejected' and nullif(btrim(rejection_reason), '') is not null and trade_id is null)
    or (state = 'qualified' and decision = 'qualified' and source_freshness = 'fresh' and trade_id is null)
    or (state = 'opened' and decision = 'paper_executed' and trade_id is not null)
    or (state = 'expired' and decision = 'expired')
    or (state = 'cancelled' and decision = 'cancelled')
    or (state = 'closed' and decision = 'closed')
    or (state = 'reviewed' and decision = 'reviewed')
  ),
  check ((trigger_direction = 'none' and trigger_price is null) or (trigger_direction <> 'none' and trigger_price is not null)),
  check (state <> 'opened' or trade_id is not null)
);

alter table public.trade_proposals enable row level security;

create policy owner_select on public.trade_proposals
  for select to authenticated
  using (is_owner());

grant select on public.trade_proposals to authenticated;
revoke insert, update, delete on public.trade_proposals from authenticated;
grant all on public.trade_proposals to service_role;

create index trade_proposals_updated_idx
  on public.trade_proposals (book_id, updated_at desc);
create index trade_proposals_trigger_idx
  on public.trade_proposals (trigger_status, review_on, symbol)
  where state = 'watch' and trigger_status = 'watching';

create or replace function public.place_morrow_paper_trade(
  p_book_id uuid,
  p_proposal_id uuid,
  p_trade jsonb
)
returns table (
  trade_id uuid,
  proposal_id uuid,
  symbol text,
  status text,
  is_real boolean,
  book_id uuid,
  proposal_state text,
  source_evidence_hash text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_proposal public.trade_proposals%rowtype;
  v_inserted public.trades%rowtype;
  v_symbol text := upper(btrim(p_trade->>'symbol'));
  v_direction text := btrim(p_trade->>'direction');
  v_horizon text := btrim(p_trade->>'horizon');
  v_setup text := btrim(p_trade->>'setup');
  v_qty numeric := (p_trade->>'qty')::numeric;
  v_entry numeric := (p_trade->>'entry_price')::numeric;
  v_target numeric := (p_trade->>'target_price')::numeric;
  v_stop numeric := (p_trade->>'stop_price')::numeric;
  v_planned_loss numeric;
  v_cost numeric;
  v_reward_risk numeric;
  v_equity numeric;
  v_buying_power numeric;
  v_existing_risk numeric;
  v_open_count bigint;
  v_today_count bigint;
  v_verified_count bigint;
  v_now timestamptz := clock_timestamp();
  v_trading_date date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if p_trade is null or jsonb_typeof(p_trade) <> 'object' then
    raise exception 'trade payload must be an object';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_book_id::text, 0));

  perform 1
  from public.paper_books as locked_book
  where locked_book.id = p_book_id
  for update;
  if not found then
    raise exception 'Robinhood Savings book unavailable';
  end if;

  select paper_book.equity, paper_book.buying_power
  into v_equity, v_buying_power
  from public.v_paper_books as paper_book
  where paper_book.book_id = p_book_id;
  if not found or v_equity is null or v_equity <= 0 or v_buying_power is null or v_buying_power < 0 then
    raise exception 'paper book risk state is unavailable';
  end if;

  select proposal.*
  into v_proposal
  from public.trade_proposals as proposal
  where proposal.id = p_proposal_id
    and proposal.book_id = p_book_id
  for update;
  if not found then
    raise exception 'qualified proposal not found';
  end if;
  if v_proposal.state <> 'qualified' then
    raise exception 'proposal is not qualified';
  end if;
  if v_proposal.source_freshness <> 'fresh'
    or v_proposal.news_checked_at < v_now - interval '6 hours'
    or v_proposal.news_checked_at > v_now + interval '5 minutes' then
    raise exception 'proposal news and source review is stale';
  end if;
  if v_proposal.symbol <> v_symbol then
    raise exception 'trade symbol does not match proposal';
  end if;

  if v_symbol is null or v_symbol !~ '^[A-Z][A-Z0-9.-]{0,9}$'
    or v_direction not in ('long', 'short')
    or v_horizon not in ('short', 'long')
    or v_setup is null
    or v_qty is null or v_qty <= 0
    or v_entry is null or v_entry <= 0
    or v_target is null or v_target <= 0
    or v_stop is null or v_stop <= 0 then
    raise exception 'trade payload is invalid';
  end if;
  if (v_direction = 'long' and not (v_stop < v_entry and v_target > v_entry))
    or (v_direction = 'short' and not (v_target < v_entry and v_stop > v_entry)) then
    raise exception 'trade target and stop geometry is invalid';
  end if;

  v_planned_loss := abs(v_entry - v_stop) * v_qty;
  v_cost := v_entry * v_qty;
  v_reward_risk := abs(v_target - v_entry) / abs(v_entry - v_stop);
  if v_reward_risk < 1.5 then
    raise exception 'reward-to-risk must be at least 1.5:1';
  end if;
  if v_planned_loss > v_equity * 0.005 then
    raise exception 'planned loss exceeds the 0.5%% per-trade cap';
  end if;
  if v_cost > v_buying_power then
    raise exception 'trade cost exceeds buying power';
  end if;

  select count(*), coalesce(sum(coalesce(
    open_trade.planned_loss,
    abs(open_trade.entry_price - open_trade.stop_price) * open_trade.qty,
    0
  )), 0)
  into v_open_count, v_existing_risk
  from public.trades as open_trade
  where open_trade.book_id = p_book_id
    and open_trade.is_real = false
    and open_trade.status = 'open';
  if v_open_count >= 3 then
    raise exception 'three open positions already exist';
  end if;
  if v_existing_risk + v_planned_loss > v_equity * 0.01 then
    raise exception 'total open risk exceeds the 1%% cap';
  end if;

  select count(*)
  into v_today_count
  from public.trades as opened_trade
  where opened_trade.book_id = p_book_id
    and opened_trade.is_real = false
    and opened_trade.opened_on = v_trading_date;
  if v_today_count >= 1 then
    raise exception 'only one new trade is allowed per New York trading date';
  end if;

  insert into public.trades (
    symbol, direction, horizon, qty, entry_price, opened_on, target_price,
    stop_price, thesis, is_real, status, book_id, setup, confidence,
    stated_upside_pct, stated_downside_pct, max_book_risk_pct, planned_loss,
    review_on, catalyst, invalidation, evidence, updated_at
  ) values (
    v_symbol,
    v_direction,
    v_horizon,
    v_qty,
    v_entry,
    v_trading_date,
    v_target,
    v_stop,
    nullif(btrim(p_trade->>'thesis'), ''),
    false,
    'open',
    p_book_id,
    v_setup,
    (p_trade->>'confidence')::integer,
    (p_trade->>'stated_upside_pct')::numeric,
    (p_trade->>'stated_downside_pct')::numeric,
    (p_trade->>'max_book_risk_pct')::numeric,
    v_planned_loss,
    (p_trade->>'review_on')::date,
    nullif(btrim(p_trade->>'catalyst'), ''),
    nullif(btrim(p_trade->>'invalidation'), ''),
    nullif(btrim(p_trade->>'evidence'), ''),
    v_now
  )
  returning * into v_inserted;

  update public.trade_proposals as linked
  set state = 'opened',
      decision = 'paper_executed',
      trade_id = v_inserted.id,
      trigger_status = 'reviewed',
      updated_at = v_now
  where linked.id = v_proposal.id
    and linked.book_id = p_book_id
    and linked.state = 'qualified';
  if not found then
    raise exception 'proposal execution link failed';
  end if;

  return query
  select inserted_trade.id,
         linked_proposal.id,
         inserted_trade.symbol,
         inserted_trade.status,
         inserted_trade.is_real,
         inserted_trade.book_id,
         linked_proposal.state,
         linked_proposal.source_evidence_hash
  from public.trades as inserted_trade
  join public.trade_proposals as linked_proposal
    on linked_proposal.trade_id = inserted_trade.id
  where inserted_trade.id = v_inserted.id
    and inserted_trade.book_id = p_book_id
    and inserted_trade.is_real = false
    and inserted_trade.status = 'open'
    and linked_proposal.id = p_proposal_id
    and linked_proposal.state = 'opened';
  get diagnostics v_verified_count = row_count;
  if v_verified_count <> 1 then
    raise exception 'atomic trade read-back failed';
  end if;
end;
$function$;

revoke all on function public.place_morrow_paper_trade(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.place_morrow_paper_trade(uuid, uuid, jsonb) to service_role;

commit;
