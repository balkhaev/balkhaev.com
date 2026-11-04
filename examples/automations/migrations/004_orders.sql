-- migrations/004_orders.sql
create table orders (
  id text primary key,
  email text not null,
  description text not null,
  amount integer not null check (amount > 0), -- in kopecks: no floats for money
  status text not null default 'pending'
    check (status in ('pending', 'paid')),
  payment_id text,
  paid_payment_id text,
  created_by text,
  reminders int not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index orders_pending on orders (created_at) where status = 'pending';

create table accesses (
  order_id text primary key references orders (id),
  token text not null unique,
  created_at timestamptz not null default now()
);
