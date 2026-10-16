-- Stripe monetization: the profile remembers its Stripe customer and subscription, and every webhook event is recorded once.
-- Written only by the Worker (service role) from the signed Stripe webhook; users can read their own profile but cannot change these columns (the column grant on profiles is display_name only).
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
create unique index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id) where stripe_customer_id is not null;

create table if not exists public.stripe_events (id text primary key, type text not null, received_at timestamptz not null default now());
alter table public.stripe_events enable row level security;                 -- no policy: service role only
