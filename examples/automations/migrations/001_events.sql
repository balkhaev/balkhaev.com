-- migrations/001_events.sql
create table events (
  id bigint generated always as identity primary key,
  source text not null,
  headers jsonb not null,
  body text not null,
  received_at timestamptz not null default now()
);

create index events_source_received_at on events (source, received_at desc);
