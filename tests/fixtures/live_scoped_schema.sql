-- Captured public catalog 2026-09-05. No live rows or identifiers.
-- Exact columns/constraints/indexes/RLS/grants of affected tables.
-- External auth.users/accounts identities and auth.uid are synthetic dependencies.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
create table public.accounts(id uuid primary key);
create table public."app_owner"(
 "user_id" uuid not null,
 "email" text not null,
 "created_at" timestamp with time zone default now() not null
);
create table public."paper_books"(
 "id" uuid default gen_random_uuid() not null,
 "account_id" uuid not null,
 "label" text not null,
 "sort_order" integer default 100 not null,
 "is_active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null
);
create table public."trades"(
 "id" uuid default gen_random_uuid() not null,
 "symbol" text not null,
 "direction" text default 'long'::text not null,
 "horizon" text default 'short'::text not null,
 "qty" numeric not null,
 "entry_price" numeric not null,
 "opened_on" date default CURRENT_DATE not null,
 "target_price" numeric,
 "stop_price" numeric,
 "thesis" text,
 "is_real" boolean default false not null,
 "status" text default 'open'::text not null,
 "exit_price" numeric,
 "closed_on" date,
 "close_note" text,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "book_id" uuid,
 "setup" text,
 "confidence" integer,
 "stated_upside_pct" numeric,
 "stated_downside_pct" numeric,
 "max_book_risk_pct" numeric,
 "planned_loss" numeric,
 "review_on" date,
 "catalyst" text,
 "invalidation" text,
 "evidence" text
);
create table public."trade_proposals"(
 "id" uuid default gen_random_uuid() not null,
 "book_id" uuid not null,
 "proposal_key" text not null,
 "owner_id" text default 'morrow'::text not null,
 "symbol" text not null,
 "asset_name" text not null,
 "asset_type" text not null,
 "state" text not null,
 "direction" text default 'long'::text not null,
 "setup" text not null,
 "horizon" text not null,
 "benchmark" text not null,
 "market_regime" text,
 "regime_uncertainty" text,
 "observed_at" timestamp with time zone not null,
 "observed_price" numeric not null,
 "entry_price" numeric not null,
 "target_price" numeric not null,
 "stop_price" numeric not null,
 "entry_condition" text not null,
 "trigger_direction" text default 'none'::text not null,
 "trigger_price" numeric,
 "trigger_status" text default 'inactive'::text not null,
 "triggered_at" timestamp with time zone,
 "last_trigger_price" numeric,
 "review_on" date not null,
 "suggested_quantity" numeric,
 "capital_committed" numeric,
 "planned_loss" numeric,
 "max_book_risk_pct" numeric,
 "reward_risk" numeric,
 "remaining_buying_power" numeric,
 "thesis" text not null,
 "bull_case" text not null,
 "bear_case" text not null,
 "catalyst" text not null,
 "invalidation" text not null,
 "evidence" jsonb default '[]'::jsonb not null,
 "source_freshness" text not null,
 "news_checked_at" timestamp with time zone not null,
 "assumptions" jsonb default '[]'::jsonb not null,
 "unresolved_claims" jsonb default '[]'::jsonb not null,
 "counter_thesis_result" text,
 "confidence" integer not null,
 "confidence_change" text,
 "expected_benchmark_edge" text,
 "decision" text not null,
 "rejection_reason" text,
 "source_evidence_hash" text not null,
 "thesis_version" integer default 1 not null,
 "last_researched_at" timestamp with time zone not null,
 "trade_id" uuid,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."app_owner" add constraint "app_owner_pkey" PRIMARY KEY (user_id);
alter table public."app_owner" add constraint "app_owner_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."trades" add constraint "trades_direction_check" CHECK (direction = ANY (ARRAY['long'::text, 'short'::text]));
alter table public."trades" add constraint "trades_horizon_check" CHECK (horizon = ANY (ARRAY['short'::text, 'long'::text]));
alter table public."trades" add constraint "trades_qty_check" CHECK (qty > 0::numeric);
alter table public."trades" add constraint "trades_entry_price_check" CHECK (entry_price > 0::numeric);
alter table public."trades" add constraint "trades_status_check" CHECK (status = ANY (ARRAY['open'::text, 'closed'::text]));
alter table public."trades" add constraint "trades_check" CHECK (status = 'open'::text OR exit_price IS NOT NULL AND closed_on IS NOT NULL);
alter table public."trades" add constraint "trades_pkey" PRIMARY KEY (id);
alter table public."paper_books" add constraint "paper_books_pkey" PRIMARY KEY (id);
alter table public."paper_books" add constraint "paper_books_account_id_key" UNIQUE (account_id);
alter table public."paper_books" add constraint "paper_books_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public."trades" add constraint "trades_book_id_fkey" FOREIGN KEY (book_id) REFERENCES paper_books(id) ON DELETE CASCADE;
alter table public."trades" add constraint "trades_setup_check" CHECK (setup IS NULL OR (setup = ANY (ARRAY['core'::text, 'swing'::text, 'catalyst'::text, 'hedge'::text])));
alter table public."trades" add constraint "trades_confidence_check" CHECK (confidence IS NULL OR confidence >= 1 AND confidence <= 100);
alter table public."trades" add constraint "trades_risk_pct_check" CHECK (max_book_risk_pct IS NULL OR max_book_risk_pct > 0::numeric AND max_book_risk_pct <= 2::numeric);
alter table public."trades" add constraint "trades_stated_rr_check" CHECK (stated_upside_pct IS NULL OR stated_downside_pct IS NULL OR stated_upside_pct > 0::numeric AND stated_downside_pct > 0::numeric AND (stated_upside_pct / stated_downside_pct) >= 1.5);
alter table public."trade_proposals" add constraint "trade_proposals_owner_id_check" CHECK (owner_id = 'morrow'::text);
alter table public."trade_proposals" add constraint "trade_proposals_symbol_check" CHECK (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'::text);
alter table public."trade_proposals" add constraint "trade_proposals_asset_type_check" CHECK (asset_type = ANY (ARRAY['equity'::text, 'etf'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_state_check" CHECK (state = ANY (ARRAY['watch'::text, 'rejected'::text, 'qualified'::text, 'opened'::text, 'expired'::text, 'cancelled'::text, 'closed'::text, 'reviewed'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_direction_check" CHECK (direction = ANY (ARRAY['long'::text, 'short'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_setup_check" CHECK (setup = ANY (ARRAY['core'::text, 'swing'::text, 'catalyst'::text, 'hedge'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_horizon_check" CHECK (horizon = ANY (ARRAY['short'::text, 'long'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_observed_price_check" CHECK (observed_price > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_entry_price_check" CHECK (entry_price > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_target_price_check" CHECK (target_price > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_stop_price_check" CHECK (stop_price > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_trigger_direction_check" CHECK (trigger_direction = ANY (ARRAY['above'::text, 'below'::text, 'none'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_trigger_price_check" CHECK (trigger_price IS NULL OR trigger_price > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_trigger_status_check" CHECK (trigger_status = ANY (ARRAY['inactive'::text, 'watching'::text, 'review_due'::text, 'reviewed'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_last_trigger_price_check" CHECK (last_trigger_price IS NULL OR last_trigger_price > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_suggested_quantity_check" CHECK (suggested_quantity IS NULL OR suggested_quantity > 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_capital_committed_check" CHECK (capital_committed IS NULL OR capital_committed >= 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_planned_loss_check" CHECK (planned_loss IS NULL OR planned_loss >= 0::numeric);
alter table public."trade_proposals" add constraint "trade_proposals_max_book_risk_pct_check" CHECK (max_book_risk_pct IS NULL OR max_book_risk_pct > 0::numeric AND max_book_risk_pct <= 0.5);
alter table public."trade_proposals" add constraint "trade_proposals_reward_risk_check" CHECK (reward_risk IS NULL OR reward_risk >= 1.5);
alter table public."trade_proposals" add constraint "trade_proposals_evidence_check" CHECK (jsonb_typeof(evidence) = 'array'::text);
alter table public."trade_proposals" add constraint "trade_proposals_source_freshness_check" CHECK (source_freshness = ANY (ARRAY['fresh'::text, 'stale'::text, 'unknown'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_assumptions_check" CHECK (jsonb_typeof(assumptions) = 'array'::text);
alter table public."trade_proposals" add constraint "trade_proposals_unresolved_claims_check" CHECK (jsonb_typeof(unresolved_claims) = 'array'::text);
alter table public."trade_proposals" add constraint "trade_proposals_confidence_check" CHECK (confidence >= 1 AND confidence <= 100);
alter table public."trade_proposals" add constraint "trade_proposals_decision_check" CHECK (decision = ANY (ARRAY['wait_for_trigger'::text, 'rejected'::text, 'qualified'::text, 'paper_executed'::text, 'expired'::text, 'cancelled'::text, 'closed'::text, 'reviewed'::text]));
alter table public."trade_proposals" add constraint "trade_proposals_source_evidence_hash_check" CHECK (source_evidence_hash ~ '^[a-f0-9]{64}$'::text);
alter table public."trade_proposals" add constraint "trade_proposals_thesis_version_check" CHECK (thesis_version >= 1);
alter table public."trade_proposals" add constraint "trade_proposals_state_decision_check" CHECK (state = 'watch'::text AND decision = 'wait_for_trigger'::text AND trigger_direction <> 'none'::text AND trade_id IS NULL OR state = 'rejected'::text AND decision = 'rejected'::text AND NULLIF(btrim(rejection_reason), ''::text) IS NOT NULL AND trade_id IS NULL OR state = 'qualified'::text AND decision = 'qualified'::text AND source_freshness = 'fresh'::text AND trade_id IS NULL OR state = 'opened'::text AND decision = 'paper_executed'::text AND trade_id IS NOT NULL OR state = 'expired'::text AND decision = 'expired'::text OR state = 'cancelled'::text AND decision = 'cancelled'::text OR state = 'closed'::text AND decision = 'closed'::text OR state = 'reviewed'::text AND decision = 'reviewed'::text);
alter table public."trade_proposals" add constraint "trade_proposals_check" CHECK (trigger_direction = 'none'::text AND trigger_price IS NULL OR trigger_direction <> 'none'::text AND trigger_price IS NOT NULL);
alter table public."trade_proposals" add constraint "trade_proposals_check1" CHECK (state <> 'opened'::text OR trade_id IS NOT NULL);
alter table public."trade_proposals" add constraint "trade_proposals_pkey" PRIMARY KEY (id);
alter table public."trade_proposals" add constraint "trade_proposals_book_id_proposal_key_key" UNIQUE (book_id, proposal_key);
alter table public."trade_proposals" add constraint "trade_proposals_book_id_fkey" FOREIGN KEY (book_id) REFERENCES paper_books(id) ON DELETE CASCADE;
alter table public."trade_proposals" add constraint "trade_proposals_trade_id_fkey" FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL;
CREATE INDEX trade_proposals_updated_idx ON public.trade_proposals USING btree (book_id, updated_at DESC);
CREATE INDEX trade_proposals_trigger_idx ON public.trade_proposals USING btree (trigger_status, review_on, symbol) WHERE ((state = 'watch'::text) AND (trigger_status = 'watching'::text));
CREATE INDEX trades_symbol_idx ON public.trades USING btree (symbol);
CREATE INDEX trades_status_idx ON public.trades USING btree (status);
CREATE INDEX trades_book_idx ON public.trades USING btree (book_id);
CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$;
  select exists (select 1 from app_owner where user_id = auth.uid());
$function$;

alter table public."app_owner" enable row level security;
alter table public."trade_proposals" enable row level security;
alter table public."trades" enable row level security;
alter table public."paper_books" enable row level security;
create policy "owner_self" on public."app_owner" as PERMISSIVE for SELECT to "public" using ((user_id = auth.uid()));
create policy "owner_select" on public."trade_proposals" as PERMISSIVE for SELECT to "authenticated" using (is_owner());
create policy "owner_all" on public."trades" as PERMISSIVE for ALL to "authenticated" using (is_owner()) with check (is_owner());
create policy "owner_all" on public."paper_books" as PERMISSIVE for ALL to "authenticated" using (is_owner()) with check (is_owner());
grant INSERT on public."app_owner" to "authenticated";
grant SELECT on public."app_owner" to "authenticated";
grant UPDATE on public."app_owner" to "authenticated";
grant DELETE on public."app_owner" to "authenticated";
grant TRUNCATE on public."app_owner" to "authenticated";
grant REFERENCES on public."app_owner" to "authenticated";
grant TRIGGER on public."app_owner" to "authenticated";
grant INSERT on public."app_owner" to "service_role";
grant SELECT on public."app_owner" to "service_role";
grant UPDATE on public."app_owner" to "service_role";
grant DELETE on public."app_owner" to "service_role";
grant TRUNCATE on public."app_owner" to "service_role";
grant REFERENCES on public."app_owner" to "service_role";
grant TRIGGER on public."app_owner" to "service_role";
grant SELECT on public."trade_proposals" to "authenticated";
grant REFERENCES on public."trade_proposals" to "authenticated";
grant TRIGGER on public."trade_proposals" to "authenticated";
grant INSERT on public."trade_proposals" to "service_role";
grant SELECT on public."trade_proposals" to "service_role";
grant UPDATE on public."trade_proposals" to "service_role";
grant DELETE on public."trade_proposals" to "service_role";
grant TRUNCATE on public."trade_proposals" to "service_role";
grant REFERENCES on public."trade_proposals" to "service_role";
grant TRIGGER on public."trade_proposals" to "service_role";
grant INSERT on public."trades" to "anon";
grant SELECT on public."trades" to "anon";
grant UPDATE on public."trades" to "anon";
grant DELETE on public."trades" to "anon";
grant TRUNCATE on public."trades" to "anon";
grant REFERENCES on public."trades" to "anon";
grant TRIGGER on public."trades" to "anon";
grant INSERT on public."trades" to "authenticated";
grant SELECT on public."trades" to "authenticated";
grant UPDATE on public."trades" to "authenticated";
grant DELETE on public."trades" to "authenticated";
grant TRUNCATE on public."trades" to "authenticated";
grant REFERENCES on public."trades" to "authenticated";
grant TRIGGER on public."trades" to "authenticated";
grant INSERT on public."trades" to "service_role";
grant SELECT on public."trades" to "service_role";
grant UPDATE on public."trades" to "service_role";
grant DELETE on public."trades" to "service_role";
grant TRUNCATE on public."trades" to "service_role";
grant REFERENCES on public."trades" to "service_role";
grant TRIGGER on public."trades" to "service_role";
grant INSERT on public."paper_books" to "anon";
grant SELECT on public."paper_books" to "anon";
grant UPDATE on public."paper_books" to "anon";
grant DELETE on public."paper_books" to "anon";
grant TRUNCATE on public."paper_books" to "anon";
grant REFERENCES on public."paper_books" to "anon";
grant TRIGGER on public."paper_books" to "anon";
grant INSERT on public."paper_books" to "authenticated";
grant SELECT on public."paper_books" to "authenticated";
grant UPDATE on public."paper_books" to "authenticated";
grant DELETE on public."paper_books" to "authenticated";
grant TRUNCATE on public."paper_books" to "authenticated";
grant REFERENCES on public."paper_books" to "authenticated";
grant TRIGGER on public."paper_books" to "authenticated";
grant INSERT on public."paper_books" to "service_role";
grant SELECT on public."paper_books" to "service_role";
grant UPDATE on public."paper_books" to "service_role";
grant DELETE on public."paper_books" to "service_role";
grant TRUNCATE on public."paper_books" to "service_role";
grant REFERENCES on public."paper_books" to "service_role";
grant TRIGGER on public."paper_books" to "service_role";
