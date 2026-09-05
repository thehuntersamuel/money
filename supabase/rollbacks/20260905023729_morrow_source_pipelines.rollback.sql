begin;
revoke insert on public.morrow_data_snapshots,public.morrow_integration_health from service_role;
-- Preserve all source hashes, metadata and research receipts.
commit;
