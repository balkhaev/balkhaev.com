-- migrations/003_leads.sql
create table leads (
  id text primary key,
  name text not null,
  contact text not null,
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'taken', 'spam')),
  qualification jsonb,
  manager text,
  taken_at timestamptz,
  telegram_message_id bigint,
  crm_id text,
  created_at timestamptz not null default now()
);
