begin;
-- Disable new writes without deleting any decisions, sources, outcomes or receipts.
revoke execute on function public.append_morrow_research(uuid,text,text,jsonb) from service_role;
revoke insert on public.morrow_research_records from service_role;
revoke insert on public.morrow_data_snapshots,public.morrow_integration_health from service_role;
commit;
