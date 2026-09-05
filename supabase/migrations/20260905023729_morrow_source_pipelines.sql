begin;
alter table public.morrow_data_snapshots drop constraint morrow_data_snapshots_provider_check;
alter table public.morrow_data_snapshots add constraint morrow_data_snapshots_provider_check check(provider in ('alpaca','tiingo','sec','bls','fred','primary'));
alter table public.morrow_data_snapshots drop constraint morrow_data_snapshots_dataset_check;
alter table public.morrow_data_snapshots add constraint morrow_data_snapshots_dataset_check check(dataset in ('alpaca_sip','tiingo_eod','sec_submissions','tiingo_news','sec_company_map','sec_facts','bls_series','fred_vintage','primary_document'));
alter table public.morrow_data_snapshots add column provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=4096);
alter table public.morrow_integration_health drop constraint morrow_integration_health_dataset_check;
alter table public.morrow_integration_health add constraint morrow_integration_health_dataset_check check(dataset in ('alpaca_sip','tiingo_eod','sec_submissions','tiingo_news','sec_company_map','sec_facts','bls_series','fred_vintage','primary_document'));
-- These records are durable archives. Ingestion is blocked unless the exact
-- provider contract permits this archive, including retained evidence/derivatives.
-- A finite-retention license is not silently treated as archival permission.
create view public.morrow_latest_integration_health with (security_invoker=true) as
 select distinct on (dataset) dataset,checked_at,status,detail,coverage
 from public.morrow_integration_health order by dataset,checked_at desc,id desc;
revoke all on public.morrow_latest_integration_health from public,anon,authenticated;
grant select on public.morrow_latest_integration_health to authenticated,service_role;
commit;
