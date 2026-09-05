begin;

create unique index if not exists trade_proposals_trade_id_unique_idx
  on public.trade_proposals (trade_id)
  where trade_id is not null;

create table if not exists public.morrow_close_receipts (
  trade_id uuid primary key references public.trades(id),
  book_id uuid not null references public.paper_books(id),
  proposal_id uuid references public.trade_proposals(id),
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.morrow_close_receipts enable row level security;
create policy owner_select on public.morrow_close_receipts for select to authenticated using (public.is_owner());
revoke all on public.morrow_close_receipts from public, anon, authenticated;
grant select on public.morrow_close_receipts to authenticated;
grant select, insert on public.morrow_close_receipts to service_role;
create or replace function public.morrow_receipt_immutable() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin raise exception 'Morrow receipts are immutable'; end; $$;
revoke all on function public.morrow_receipt_immutable() from public, anon, authenticated;
create trigger immutable_receipt before update or delete on public.morrow_close_receipts
for each row execute function public.morrow_receipt_immutable();

create or replace function public.close_morrow_paper_trade(
  p_book_id uuid,
  p_trade_id uuid,
  p_exit_price numeric,
  p_close_note text
)
returns table (
  trade_id uuid,
  proposal_id uuid,
  symbol text,
  status text,
  is_real boolean,
  book_id uuid,
  exit_price numeric,
  close_note text,
  closed_on date,
  updated_at timestamptz,
  proposal_state text,
  proposal_decision text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_trade public.trades%rowtype;
  v_proposal_id uuid;
  v_proposal_state text;
  v_proposal_decision text;
  v_proposal_book_id uuid;
  v_proposal_symbol text;
  v_receipt jsonb;
  v_proposal_update_count bigint;
  v_verified_count bigint;
  v_now timestamptz := clock_timestamp();
  v_trading_date date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if p_exit_price is null or p_exit_price <= 0 or p_exit_price::text in ('NaN','Infinity','-Infinity') then
    raise exception 'exit price must be positive';
  end if;
  if nullif(btrim(p_close_note), '') is null or length(p_close_note) > 4000 then
    raise exception 'close note is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_book_id::text, 0));

  perform 1
  from public.paper_books as locked_book
  where locked_book.id = p_book_id and locked_book.label = 'Robinhood Savings'
  for update;
  if not found then
    raise exception 'Robinhood Savings book unavailable';
  end if;

  select open_trade.*
  into v_trade
  from public.trades as open_trade
  where open_trade.id = p_trade_id
    and open_trade.book_id = p_book_id
    and open_trade.is_real = false
  for update;
  if not found then
    raise exception 'open paper trade not found';
  end if;

  select proposal.id, proposal.state, proposal.decision, proposal.book_id, proposal.symbol
  into v_proposal_id, v_proposal_state, v_proposal_decision, v_proposal_book_id, v_proposal_symbol
  from public.trade_proposals as proposal
  where proposal.trade_id = v_trade.id
  for update;
  if found then
    if v_proposal_book_id <> p_book_id then
      raise exception 'linked proposal book does not match trade book';
    end if;
    if v_proposal_symbol <> v_trade.symbol then
      raise exception 'linked proposal symbol does not match trade';
    end if;
    if v_proposal_state <> (case when v_trade.status = 'closed' then 'closed' else 'opened' end) then
      raise exception 'linked proposal is not opened';
    end if;
  end if;

  if v_trade.status = 'closed' then
    select r.receipt into v_receipt from public.morrow_close_receipts as r where r.trade_id = v_trade.id;
    if v_receipt is null or v_trade.exit_price is distinct from p_exit_price
      or v_trade.close_note is distinct from btrim(p_close_note) then
      raise exception 'conflicting close or legacy close without canonical receipt';
    end if;
    return query select v_trade.id, v_proposal_id, v_trade.symbol, v_trade.status,
      v_trade.is_real, v_trade.book_id, v_trade.exit_price, v_trade.close_note,
      v_trade.closed_on, v_trade.updated_at, v_proposal_state, v_proposal_decision;
    return;
  end if;

  update public.trades as closing_trade
  set status = 'closed',
      exit_price = p_exit_price,
      closed_on = v_trading_date,
      close_note = btrim(p_close_note),
      updated_at = v_now
  where closing_trade.id = v_trade.id
    and closing_trade.book_id = p_book_id
    and closing_trade.is_real = false
    and closing_trade.status = 'open'
  returning closing_trade.* into v_trade;
  if not found then
    raise exception 'paper trade close failed';
  end if;

  if v_proposal_id is not null then
    update public.trade_proposals as linked
    set state = 'closed',
        decision = 'closed',
        trigger_status = 'reviewed',
        updated_at = v_now
    where linked.trade_id = v_trade.id
      and linked.book_id = p_book_id
      and linked.state = 'opened'
    returning linked.state, linked.decision into v_proposal_state, v_proposal_decision;
    get diagnostics v_proposal_update_count = row_count;
    if v_proposal_update_count <> 1 or v_proposal_state <> 'closed' then
      raise exception 'linked proposal close transition failed';
    end if;
  end if;

  insert into public.morrow_close_receipts(trade_id,book_id,proposal_id,receipt)
  values(v_trade.id,p_book_id,v_proposal_id,jsonb_build_object(
    'trade_id',v_trade.id,'book_id',p_book_id,'proposal_id',v_proposal_id,
    'exit_price',v_trade.exit_price,'close_note',v_trade.close_note,
    'closed_on',v_trade.closed_on,'updated_at',v_trade.updated_at,
    'proposal_state',v_proposal_state,'proposal_decision',v_proposal_decision));

  return query
  select v_trade.id,
         v_proposal_id,
         v_trade.symbol,
         v_trade.status,
         v_trade.is_real,
         v_trade.book_id,
         v_trade.exit_price,
         v_trade.close_note,
         v_trade.closed_on,
         v_trade.updated_at,
         v_proposal_state,
         v_proposal_decision;
  get diagnostics v_verified_count = row_count;
  if v_verified_count <> 1 then
    raise exception 'atomic close read-back failed';
  end if;
end;
$function$;

revoke all on function public.close_morrow_paper_trade(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.close_morrow_paper_trade(uuid, uuid, numeric, text) to service_role;

commit;
