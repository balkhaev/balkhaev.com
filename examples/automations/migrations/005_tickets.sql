-- migrations/005_tickets.sql
create table tickets (
  id bigserial primary key,
  source_id text not null unique, -- tg:<chat>:<message> or the email's MessageID in Postmark
  channel text not null check (channel in ('telegram', 'email')),
  customer text not null,         -- Telegram chat id or email address
  name text not null default '',
  subject text not null default '',
  message text not null,
  status text not null default 'new' check (status in ('new', 'answered', 'closed')),
  triage jsonb,
  answer text,
  draft_used boolean,             -- sent the model's draft as is, or wrote their own
  agent text,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index tickets_customer on tickets (customer, created_at);
create index tickets_card on tickets (telegram_message_id);
