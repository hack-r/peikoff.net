-- Chat log: every question and answer, who asked, which person answered, what it cost. Written and read only by the Worker / the project owner (service role).
create table if not exists public.chat_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  admin       boolean not null default false,
  person_id   text not null,
  person_name text,
  turn        integer not null default 1,        -- how many messages the conversation held when this was asked (1 = the opening question)
  question    text not null,
  answer      text,
  cached      boolean not null default false,    -- served from the shared reply cache (no model call)
  refused     boolean not null default false,
  model       text,
  cost_micro  bigint not null default 0          -- micro-dollars (1e-6 USD) charged to the user's allowance
);
alter table public.chat_log enable row level security;     -- no policy: the public API cannot read or write it
create index if not exists chat_log_created_idx on public.chat_log (created_at desc);
create index if not exists chat_log_user_idx on public.chat_log (user_id, created_at desc);
