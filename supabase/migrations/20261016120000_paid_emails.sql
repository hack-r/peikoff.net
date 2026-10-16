-- Emails that get the paid plan the moment they sign up (until billing exists). Only the service role and the dashboard can edit the list:
-- row level security is on and there is no policy.
create table if not exists public.paid_emails (email text primary key, note text, created_at timestamptz not null default now());
alter table public.paid_emails enable row level security;
insert into public.paid_emails (email, note) values ('asonpeikoff@gmail.com', 'owner') on conflict (email) do nothing;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, plan)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          case when exists (select 1 from public.paid_emails e where lower(e.email) = lower(new.email)) then 'paid' else 'free' end)
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
