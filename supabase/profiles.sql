create table if not exists public.profiles (
  id text primary key,
  name text not null,
  latest_arrival_time text not null,
  bus_json text,
  mtr_json text,
  car_json text,
  tunnel_indicator_id text,
  created_at text not null,
  updated_at text not null
);

create index if not exists profiles_updated_at_idx
  on public.profiles (updated_at desc);

alter table public.profiles enable row level security;
