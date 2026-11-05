# Decisions

Short ADR-style entries. Newest at the bottom.

## 0001 — Supabase over Firebase

Chosen for real Postgres (RLS) and the team's existing SQL fluency.
Date: 2026-09-12.

## 0002 — RLS is mandatory

Every table ships with row-level security enabled on day one, even single-tenant
ones. Cheaper than retrofitting. Enforced by check `rls-required-on-new-tables`.
Date: 2026-09-12.

## 0003 — Stripe redirect checkout, no embedded elements

Redirect flow keeps PCI scope minimal and works without webhooks for MVP.
Date: 2026-10-02.

## 0004 — Guest checkout only for launch

Accounts deferred until repeat-purchase data justifies them. Do not add auth
scaffolding "while we're in there". Date: 2026-10-20.
