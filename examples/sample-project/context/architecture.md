# Architecture: Acme Storefront

## Stack

- Next.js 15 (App Router) deployed on Vercel.
- Supabase: Postgres + Auth (future) + Storage for product images.
- Payments: Stripe Checkout (redirect flow, no webhooks on Vercel yet).

## Layout

- `app/` — routes (App Router). Server Components by default.
- `src/lib/` — shared client-safe helpers. Never import server-only modules here.
- `supabase/migrations/` — SQL migrations, one file per change, applied in order.

## Data access rules

- The client uses the Supabase **anon key** with RLS policies only.
- The service-role key lives exclusively in Edge Functions / server routes.
- Every table must have row-level security enabled before it ships (ADR 0002).

## Conventions

- Server Components fetch data directly; client Components only for interactivity.
- No `console.log` in production code — use the `logger` from `src/lib/logger.ts`.
