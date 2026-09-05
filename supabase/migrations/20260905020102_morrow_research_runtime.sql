begin;
create table public.morrow_research_records (
 id uuid primary key default gen_random_uuid(),
 book_id uuid not null references public.paper_books(id),
 kind text not null check(kind in ('source','decision','strategy','outcome','run','audit','evaluation')),
 idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_.:-]{1,160}$'),
 created_at timestamptz not null default clock_timestamp(),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
 server_sha256 text not null check(server_sha256 ~ '^[a-f0-9]{64}$'),
 unique(book_id,idempotency_key)
);
create index morrow_research_book_created on public.morrow_research_records(book_id,created_at desc,id desc);
alter table public.morrow_research_records enable row level security;
revoke all on public.morrow_research_records from public,anon,authenticated;
grant select on public.morrow_research_records to authenticated;
grant select,insert on public.morrow_research_records to service_role;
create policy owner_select on public.morrow_research_records for select to authenticated using(public.is_owner());
create trigger immutable_research before update or delete on public.morrow_research_records
for each row execute function public.morrow_receipt_immutable();

create function public.append_morrow_research(p_book_id uuid,p_kind text,p_key text,p_payload jsonb)
returns public.morrow_research_records language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing public.morrow_research_records; ref text; related public.morrow_research_records;
begin
 if not exists(select 1 from public.paper_books b where b.id=p_book_id and b.label='Robinhood Savings') then raise exception 'research book unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_book_id::text||':'||p_key,0));
 select * into existing from public.morrow_research_records r where r.book_id=p_book_id and r.idempotency_key=p_key;
 if found then
  if existing.kind<>p_kind or existing.payload<>p_payload then raise exception 'research idempotency conflict'; end if;
  return existing;
 end if;
 if p_kind='decision' then
  for ref in select jsonb_array_elements_text(coalesce(p_payload->'source_ids','[]'::jsonb)) loop
   select * into related from public.morrow_research_records r where r.id::text=ref and r.book_id=p_book_id and r.kind='source';
   if not found then raise exception 'source reference unavailable'; end if;
   if p_payload->>'disposition'='research_qualified' and related.payload->>'source_type' not in ('sec','issuer','regulator','macro') then raise exception 'primary source required'; end if;
  end loop;
  if p_payload->>'strategy_id' is not null and not exists(select 1 from public.morrow_research_records r where r.id::text=p_payload->>'strategy_id' and r.book_id=p_book_id and r.kind='strategy') then raise exception 'strategy reference unavailable'; end if;
 end if;
 if p_kind='outcome' then
  if not exists(select 1 from public.morrow_research_records r where r.id::text=p_payload->>'decision_id' and r.book_id=p_book_id and r.kind='decision') then raise exception 'decision reference unavailable'; end if;
  if p_payload->>'cohort'='paper' then
   if jsonb_array_length(coalesce(p_payload->'receipt_ids','[]'::jsonb))=0 then raise exception 'paper receipt required'; end if;
   for ref in select jsonb_array_elements_text(p_payload->'receipt_ids') loop
    if not exists(select 1 from public.morrow_close_receipts r where r.trade_id::text=ref and r.book_id=p_book_id) then raise exception 'canonical close receipt unavailable'; end if;
   end loop;
  end if;
 end if;
 if p_kind='evaluation' then
  for ref in select x->>'receipt_id' from jsonb_array_elements(p_payload->'opportunities') x where x->>'cohort'='paper' loop
   if not exists(select 1 from public.morrow_close_receipts r where r.trade_id::text=ref and r.book_id=p_book_id) then raise exception 'evaluation close receipt unavailable'; end if;
  end loop;
 end if;
 insert into public.morrow_research_records(book_id,kind,idempotency_key,payload,server_sha256)
 values(p_book_id,p_kind,p_key,p_payload,encode(sha256(convert_to(p_kind||E'\n'||p_payload::text,'UTF8')),'hex')) returning * into existing;
 return existing;
end; $$;
revoke all on function public.append_morrow_research(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.append_morrow_research(uuid,text,text,jsonb) to service_role;
create table public.morrow_data_snapshots (
 id uuid primary key default gen_random_uuid(), provider text not null check(provider in ('alpaca','tiingo','sec')),
 dataset text not null check(dataset in ('alpaca_sip','tiingo_eod','sec_submissions')),
 received_at timestamptz not null default clock_timestamp(), display_allowed boolean not null default false,
 payload jsonb not null check(octet_length(payload::text)<=8000000)
);
create index morrow_data_dataset_received on public.morrow_data_snapshots(dataset,received_at desc);
alter table public.morrow_data_snapshots enable row level security;
revoke all on public.morrow_data_snapshots from public,anon,authenticated;
grant select,insert on public.morrow_data_snapshots to service_role;
create trigger immutable_data_snapshot before update or delete on public.morrow_data_snapshots for each row execute function public.morrow_receipt_immutable();
create table public.morrow_integration_health (
 id uuid primary key default gen_random_uuid(), dataset text not null check(dataset in ('alpaca_sip','tiingo_eod','sec_submissions')),
 checked_at timestamptz not null default clock_timestamp(), status text not null check(status in ('ok','blocked','failed')),
 detail text not null check(length(detail)<=200), coverage text not null check(length(coverage)<=200)
);
create index morrow_health_dataset_time on public.morrow_integration_health(dataset,checked_at desc);
alter table public.morrow_integration_health enable row level security;
revoke all on public.morrow_integration_health from public,anon,authenticated;
grant select on public.morrow_integration_health to authenticated;
grant select,insert on public.morrow_integration_health to service_role;
create policy owner_select on public.morrow_integration_health for select to authenticated using(public.is_owner());
create trigger immutable_integration_health before update or delete on public.morrow_integration_health for each row execute function public.morrow_receipt_immutable();

commit;
