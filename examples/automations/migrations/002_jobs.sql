-- migrations/002_jobs.sql
alter table events add column dedup_key text;
create unique index events_source_dedup on events (source, dedup_key);

create table jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 8,
  run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  key text unique,
  event_id bigint references events (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_due on jobs (run_at) where status in ('pending', 'running');
