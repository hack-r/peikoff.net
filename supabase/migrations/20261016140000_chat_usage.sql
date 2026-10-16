-- Usage caps: what each user's chat has cost, per day, in micro-dollars (1e-6 USD). Written and read only by the Worker (service role).
create table if not exists public.chat_usage (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  cost_micro bigint not null default 0,
  messages   integer not null default 0,
  tokens     bigint not null default 0,
  primary key (user_id, day)
);
alter table public.chat_usage enable row level security;     -- no policy: the public API cannot read or write it

create or replace function public.chat_usage_add(uid uuid, d date, c bigint, t bigint) returns void language sql security definer set search_path = '' as $$
  insert into public.chat_usage (user_id, day, cost_micro, messages, tokens) values (uid, d, c, 1, t)
  on conflict (user_id, day) do update set cost_micro = public.chat_usage.cost_micro + excluded.cost_micro, messages = public.chat_usage.messages + 1, tokens = public.chat_usage.tokens + excluded.tokens;
$$;
revoke all on function public.chat_usage_add(uuid, date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.chat_usage_add(uuid, date, bigint, bigint) to service_role;
