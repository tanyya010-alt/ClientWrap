-- ClientWrap initial schema.
-- Security model:
--   * Every table has ROW LEVEL SECURITY enabled AND forced (the table owner is restricted too).
--   * Runtime code never queries as the owner. Each transaction does SET LOCAL ROLE to either:
--       cw_app      tenant role: sees only rows of app.workspace_id / app.user_id
--       cw_service  trusted server role for webhooks, jobs, auth and admin lookups
--   * Tables that hold tenant data carry workspace_id. Identity/licensing tables are keyed by user_id.
--   * Tables with no cw_app policy (sessions, jobs, license_events, ...) are invisible to tenant code.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cw_app') then
    create role cw_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'cw_service') then
    create role cw_service nologin;
  end if;
  if current_setting('server_version_num')::int >= 160000 then
    execute format('grant cw_app to %I with inherit false, set true', current_user);
    execute format('grant cw_service to %I with inherit false, set true', current_user);
  else
    execute format('grant cw_app to %I', current_user);
    execute format('grant cw_service to %I', current_user);
  end if;
end $$;

create schema if not exists app;
grant usage on schema app to cw_app, cw_service;
grant usage on schema public to cw_app, cw_service;

create or replace function app.user_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app.workspace_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- identity
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  password_hash text,
  google_sub text unique,
  email_verified_at timestamptz,
  refund_block_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on sessions (user_id);

create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text not null check (kind in ('verify_email','reset_password')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- workspaces
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  service_type text not null default 'general',
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  brand_color text not null default '#4f46e5',
  accent_color text not null default '#0ea5e9',
  logo_data text,
  remove_branding boolean not null default false,
  custom_domain text unique,
  custom_domain_token text,
  custom_domain_verified_at timestamptz,
  email_from_name text,
  email_from_address text,
  email_domain_id text,
  email_domain_records jsonb,
  email_domain_verified_at timestamptz,
  reply_to_email text,
  quiet_hours_start int not null default 20 check (quiet_hours_start between 0 and 23),
  quiet_hours_end int not null default 8 check (quiet_hours_end between 0 and 23),
  skip_weekends boolean not null default true,
  ai_provider text check (ai_provider in ('anthropic','openai')),
  ai_api_key_enc text,
  ai_model text,
  twilio_account_sid text,
  twilio_auth_token_enc text,
  twilio_from_sms text,
  twilio_from_whatsapp text,
  stripe_secret_key_enc text,
  stripe_webhook_secret_enc text,
  stripe_webhook_endpoint_id text,
  stripe_account_name text,
  payment_instructions text,
  onboarding_step int not null default 0,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on workspaces (owner_id);

create table clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  timezone text,
  currency text,
  logo_data text,
  brand_color text,
  service_description text,
  monthly_fee_cents int,
  contract_end_date date,
  metric_config jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  reminders_paused boolean not null default false,
  report_day int check (report_day between 1 and 28),
  report_auto_send boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on clients (workspace_id);

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  channel text not null check (channel in ('email','sms','whatsapp')),
  action text not null check (action in ('granted','revoked','unsubscribed','resubscribed')),
  source text not null,
  evidence text,
  ip text,
  created_at timestamptz not null default now()
);
create index on consent_records (client_id, channel, created_at desc);

create table portal_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0
);
create index on portal_links (client_id);

create table webhook_secrets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  public_token text not null unique,
  secret_enc text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table metric_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  metric text not null,
  value numeric not null,
  unit text not null default '',
  occurred_at timestamptz not null,
  source text not null check (source in ('manual','csv','webhook','demo')),
  idempotency_key text,
  created_at timestamptz not null default now()
);
create index on metric_events (client_id, occurred_at);
create unique index metric_events_idem on metric_events (client_id, idempotency_key) where idempotency_key is not null;

create table csv_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  filename text,
  mapping jsonb not null,
  rows_total int not null,
  rows_imported int not null,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  data_snapshot jsonb not null,
  narrative text not null default '',
  next_step text not null default '',
  ai_generated boolean not null default false,
  status text not null default 'draft' check (status in ('draft','sent')),
  sent_at timestamptz,
  sent_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  number text not null,
  currency text not null default 'USD',
  issue_date date not null default current_date,
  due_date date not null,
  status text not null default 'draft' check (status in ('draft','open','paid','void')),
  total_cents int not null default 0,
  notes text,
  stripe_payment_link_id text,
  stripe_payment_link_url text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);
create index on invoices (status, due_date);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_amount_cents int not null,
  amount_cents int not null,
  position int not null default 0
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount_cents int not null,
  currency text not null,
  method text not null check (method in ('stripe','manual')),
  stripe_event_id text unique,
  stripe_payment_intent text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table reminder_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  offset_days int not null check (offset_days between -30 and 90),
  channel text not null default 'email' check (channel in ('email','sms','whatsapp')),
  template_key text not null,
  custom_message text,
  whatsapp_content_sid text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, offset_days, channel)
);

create table message_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  report_id uuid references reports(id) on delete set null,
  kind text not null check (kind in ('reminder','report','invoice','referral','case_study_approval','receipt','test')),
  channel text not null check (channel in ('email','sms','whatsapp')),
  step_key text,
  recipient text,
  subject text,
  body text,
  status text not null check (status in ('sent','failed','skipped')),
  skip_reason text,
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index on message_log (workspace_id, created_at desc);
create unique index message_log_reminder_once on message_log (invoice_id, step_key) where kind = 'reminder' and status = 'sent';

create table case_studies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  report_id uuid references reports(id) on delete set null,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','changes_requested','published')),
  client_feedback text,
  approved_by_name text,
  approved_at timestamptz,
  public_slug text unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table renewal_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  body text not null,
  visible_in_portal boolean not null default false,
  created_at timestamptz not null default now()
);

create table usage_counters (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  period text not null,
  metric text not null,
  count int not null default 0,
  primary key (workspace_id, period, metric)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  actor text not null default 'user',
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index on audit_log (workspace_id, created_at desc);

-- ---------------------------------------------------------------- licensing & billing
create table licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text not null unique,
  user_id uuid references users(id) on delete set null,
  tier int not null default 1,
  status text not null default 'inactive' check (status in ('inactive','active','deactivated')),
  plan_id text,
  prev_license_key text,
  superseded_by text,
  test boolean not null default false,
  purchased_at timestamptz,
  activated_at timestamptz,
  redeemed_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on licenses (user_id);

create table license_events (
  id uuid primary key default gen_random_uuid(),
  license_key text not null,
  event text not null,
  source text not null default 'webhook' check (source in ('webhook','oauth','csv_reconciliation','redeem')),
  payload jsonb not null,
  signature text,
  dedupe_hash text not null unique,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create index on license_events (license_key, received_at desc);

-- A user completed AppSumo OAuth before the purchase/activate webhook arrived. The license is
-- attached as soon as the webhook creates it (license state still only comes from webhooks).
create table pending_redemptions (
  license_key text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan text not null,
  billing_interval text not null default 'month',
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table stripe_events (
  id text primary key,
  scope text not null,
  workspace_id uuid,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending','running','done','dead')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  locked_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index on jobs (status, run_at);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  to_address text not null,
  from_address text not null,
  subject text not null,
  html text not null,
  text_body text,
  provider text not null,
  provider_id text,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete set null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table error_events (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
do $$
declare
  t text;
  tenant_tables text[] := array['clients','consent_records','portal_links','webhook_secrets','metric_events',
    'csv_imports','reports','invoices','invoice_items','payments','reminder_rules','message_log',
    'case_studies','renewal_suggestions','usage_counters'];
  all_tables text[] := array['users','sessions','auth_tokens','workspaces','clients','consent_records','portal_links',
    'webhook_secrets','metric_events','csv_imports','reports','invoices','invoice_items','payments','reminder_rules',
    'message_log','case_studies','renewal_suggestions','usage_counters','audit_log','licenses','license_events','pending_redemptions',
    'subscriptions','stripe_events','jobs','rate_limits','email_outbox','support_tickets','error_events'];
begin
  foreach t in array all_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('grant select, insert, update, delete on %I to cw_service', t);
    execute format('create policy service_all on %I for all to cw_service using (true) with check (true)', t);
  end loop;

  foreach t in array tenant_tables loop
    execute format('grant select, insert, update, delete on %I to cw_app', t);
    execute format('create policy tenant_isolation on %I for all to cw_app using (workspace_id = app.workspace_id()) with check (workspace_id = app.workspace_id())', t);
  end loop;
end $$;

-- Workspaces: a tenant may read/update only the current workspace, and only if it owns it.
grant select, update on workspaces to cw_app;
create policy tenant_isolation on workspaces for all to cw_app
  using (id = app.workspace_id() and owner_id = app.user_id())
  with check (id = app.workspace_id() and owner_id = app.user_id());

-- Users: only yourself.
grant select, update on users to cw_app;
create policy self_only on users for all to cw_app using (id = app.user_id()) with check (id = app.user_id());

-- Licenses & subscriptions: tenant can read its own, never write (state comes from webhooks only).
grant select on licenses, subscriptions to cw_app;
create policy own_read on licenses for select to cw_app using (user_id = app.user_id());
create policy own_read on subscriptions for select to cw_app using (user_id = app.user_id());

-- Audit log: read/append within the current workspace, never update/delete.
grant select, insert on audit_log to cw_app;
create policy tenant_read on audit_log for select to cw_app using (workspace_id = app.workspace_id());
create policy tenant_append on audit_log for insert to cw_app with check (workspace_id = app.workspace_id());

grant usage on all sequences in schema public to cw_app, cw_service;
