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
  v_proposal_update_count bigint;
  v_verified_count bigint;
  v_now timestamptz := clock_timestamp();
  v_trading_date date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if p_exit_price is null or p_exit_price <= 0 then
    raise exception 'exit price must be positive';
  end if;
  if nullif(btrim(p_close_note), '') is null then
    raise exception 'close note is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_book_id::text, 0));

  perform 1
  from public.paper_books as locked_book
  where locked_book.id = p_book_id
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
    and open_trade.status = 'open'
  for update;
  if not found then
    raise exception 'open paper trade not found';
  end if;

  select proposal.id, proposal.state, proposal.decision, proposal.book_id
  into v_proposal_id, v_proposal_state, v_proposal_decision, v_proposal_book_id
  from public.trade_proposals as proposal
  where proposal.trade_id = v_trade.id
  for update;
  if found then
    if v_proposal_book_id <> p_book_id then
      raise exception 'linked proposal book does not match trade book';
    end if;
    if v_proposal_state <> 'opened' then
      raise exception 'linked proposal is not opened';
    end if;
  end if;

  update public.trades
  set status = 'closed',
      exit_price = p_exit_price,
      closed_on = v_trading_date,
      close_note = btrim(p_close_note),
      updated_at = v_now
  where id = v_trade.id
    and book_id = p_book_id
    and is_real = false
    and status = 'open'
  returning * into v_trade;
  if not found then
    raise exception 'paper trade close failed';
  end if;

  if v_proposal_id is not null then
    update public.trade_proposals
    set state = 'closed',
        decision = 'closed',
        trigger_status = 'reviewed',
        updated_at = v_now
    where trade_id = v_trade.id
      and book_id = p_book_id
      and state = 'opened'
    returning state, decision into v_proposal_state, v_proposal_decision;
    get diagnostics v_proposal_update_count = row_count;
    if v_proposal_update_count <> 1 or v_proposal_state <> 'closed' then
      raise exception 'linked proposal close transition failed';
    end if;
  end if;

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
