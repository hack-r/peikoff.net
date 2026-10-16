-- Usage caps got a questions limit and a token limit: the table counts tokens too, and the counting function takes them.
-- (For a project that applied 20261016140000 before this: this brings it up to date. A fresh project gets the same result from 140000 alone, and this file is then a no-op.)
alter table public.chat_usage add column if not exists tokens bigint not null default 0;
drop function if exists public.chat_usage_add(uuid, date, bigint);
create or replace function public.chat_usage_add(uid uuid, d date, c bigint, t bigint) returns void language sql security definer set search_path = '' as $$
  insert into public.chat_usage (user_id, day, cost_micro, messages, tokens) values (uid, d, c, 1, t)
  on conflict (user_id, day) do update set cost_micro = public.chat_usage.cost_micro + excluded.cost_micro, messages = public.chat_usage.messages + 1, tokens = public.chat_usage.tokens + excluded.tokens;
$$;
revoke all on function public.chat_usage_add(uuid, date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.chat_usage_add(uuid, date, bigint, bigint) to service_role;
