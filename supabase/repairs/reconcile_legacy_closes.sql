-- Operator-only DML repair. Uses the existing append-only audit/history ledgers.
-- Never creates an execution receipt or alters an existing trade/fill/date.
-- Run only after independent review and isolated PostgreSQL rehearsal.
begin;
set local role service_role;
do $repair$
declare
 v_book uuid;
 v_trade public.trades%rowtype;
 v_proposal public.trade_proposals%rowtype;
 v_trade_hash text;
 v_key text;
 v_count integer := 0;
begin
 select id into v_book from public.paper_books where label='Robinhood Savings';
 if not found then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_book::text,0));
 perform 1 from public.paper_books where id=v_book and label='Robinhood Savings' for update;
 if not found then raise exception 'Savings scope changed'; end if;
 for v_trade in
  select t.* from public.trades t
  where t.book_id=v_book and t.is_real=false and t.status='closed'
   and exists(select 1 from public.trade_proposals p where p.trade_id=t.id and p.state='opened')
  order by t.id for update
 loop
  v_count:=v_count+1;
  if v_count>100 then raise exception 'Legacy repair exceeds reviewed batch bound'; end if;
  select * into strict v_proposal from public.trade_proposals where trade_id=v_trade.id for update;
  if v_proposal.state<>'opened' then continue; end if;
  if v_proposal.book_id<>v_book or v_proposal.symbol<>v_trade.symbol then raise exception 'Legacy proposal identity mismatch'; end if;
  if exists(select 1 from public.morrow_close_receipts where trade_id=v_trade.id) then raise exception 'Canonical receipt inconsistency requires separate review'; end if;
  if v_trade.exit_price is null or v_trade.exit_price<=0 or v_trade.exit_price::text in ('NaN','Infinity','-Infinity')
    or v_trade.closed_on is null or nullif(btrim(v_trade.close_note),'') is null then
   raise exception 'Legacy close evidence incomplete';
  end if;
  v_trade_hash:=encode(sha256(convert_to(to_jsonb(v_trade)::text,'UTF8')),'hex');
  v_key:='legacy-close-reconciled:'||v_trade.id::text;
  if exists(select 1 from public.morrow_research_records where book_id=v_book and idempotency_key=v_key) then
   raise exception 'Previously reconciled proposal reopened; operator review required';
  end if;
  update public.trade_proposals set state='closed',decision='closed',trigger_status='reviewed',updated_at=clock_timestamp()
   where id=v_proposal.id and book_id=v_book and state='opened';
  if not found then raise exception 'Legacy proposal reconciliation failed'; end if;
  -- The proposal trigger retains both original and resulting snapshots.
  perform public.append_morrow_research(v_book,'audit',v_key,jsonb_build_object(
   'subject','legacy_close_reconciliation','status','reconciled_without_execution_receipt',
   'evidence_ids',jsonb_build_array(v_trade.id::text,v_proposal.id::text),
   'blockers',jsonb_build_array('original_execution_receipt_unavailable'),
   'note','Historical closed paper trade reconciled to terminal proposal state. No trade values altered and no new execution/fill certified. Before/after proposal snapshots retained in morrow_proposal_history. Original trade snapshot SHA-256: '||v_trade_hash));
  if (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') from public.trades t where id=v_trade.id)<>v_trade_hash then
   raise exception 'Trade changed during reconciliation';
  end if;
 end loop;
end;
$repair$;
commit;
