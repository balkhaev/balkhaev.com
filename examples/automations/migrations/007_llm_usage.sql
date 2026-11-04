-- migrations/007_llm_usage.sql
-- One row per model request: what it was for, the tokens and what it cost
create table llm_usage (
  id bigint generated always as identity primary key,
  task text not null,
  model text not null,
  input_tokens int not null,
  cache_read_tokens int not null,
  cache_write_tokens int not null,
  output_tokens int not null,
  cost numeric(12, 6) not null, -- dollars
  created_at timestamptz not null default now()
);

create index llm_usage_created on llm_usage (created_at);
