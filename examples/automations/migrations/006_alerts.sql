-- migrations/006_alerts.sql
-- Alerts that are firing right now. A row appears when a problem starts and
-- disappears when it ends, so each problem gives exactly two messages.
create table alerts (
  name text primary key,
  text text not null,
  since timestamptz not null default now()
);

-- The digest and the alerts filter by these columns every day
create index leads_created on leads (created_at);
create index orders_paid on orders (paid_at) where paid_at is not null;
create index tickets_created on tickets (created_at);
create index tickets_answered on tickets (answered_at) where answered_at is not null;
