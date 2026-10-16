-- Accounts and the shared chat cache for the Atlas (peikoff.net). Apply to the Supabase project the Worker points at (SUPABASE_URL).
-- Sign-in itself is Supabase Auth (email magic link, Google): nothing to create for that except turning the providers on.

-- 1. A profile per user: the plan decides whether they may chat (the paywall). Billing will set `plan` later; users can never change it themselves.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan        text not null default 'free' check (plan in ('free', 'paid')),
  paid_until  timestamptz,                       -- null = no end date; a past date = lapsed
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "rename self" on public.profiles;
create policy "rename self" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;   -- only the display name; plan and paid_until stay with the service role

-- a profile row appears with every new user
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 2. The shared reply cache: the first question of a conversation, per character and per version of the prompt, answered once for everybody.
--    Only the Worker (service role) touches it: row level security is on and no policy exists, so the public API cannot read or write it.
create table if not exists public.chat_cache (
  key        text primary key,                   -- sha256 of: person, prompt version, normalized question
  person_id  text not null,
  reply      text not null,
  hits       integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit   timestamptz
);
alter table public.chat_cache enable row level security;
create index if not exists chat_cache_created_idx on public.chat_cache (created_at);

create or replace function public.chat_cache_hit(k text) returns void language sql security definer set search_path = '' as $$
  update public.chat_cache set hits = hits + 1, last_hit = now() where key = k;
$$;
revoke all on function public.chat_cache_hit(text) from public, anon, authenticated;
grant execute on function public.chat_cache_hit(text) to service_role;
