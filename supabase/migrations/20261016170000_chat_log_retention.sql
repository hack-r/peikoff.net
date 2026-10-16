-- Retention: chat text is kept 90 days. After that only anonymous statistics and events remain (time, person, turn, cached, refused, model, cost).
alter table public.chat_log alter column question drop not null;
alter table public.chat_log add column if not exists scrubbed_at timestamptz;

create or replace function public.chat_log_prune(days integer default 90) returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.chat_log
     set question = null, answer = null, email = null, user_id = null, scrubbed_at = now()
   where scrubbed_at is null and created_at < now() - make_interval(days => days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.chat_log_prune(integer) from public, anon, authenticated;
grant execute on function public.chat_log_prune(integer) to service_role;

-- Daily at 03:17 UTC (needs the pg_cron extension).
create extension if not exists pg_cron;
select cron.schedule('chat-log-prune', '17 3 * * *', 'select public.chat_log_prune(90)');
