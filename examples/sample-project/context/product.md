# Product: Acme Storefront

Acme sells handcrafted furniture online. The storefront is the only sales
channel; the back office runs on spreadsheets and email today.

## What matters to the business

- Checkout must never break silently — a failed order is lost revenue.
- The catalog team (non-technical) edits products in Supabase directly.
- Peak traffic is seasonal (Nov–Dec); the site must survive 10× baseline.

## Current scope

- Browse, search, product detail, cart, checkout.
- Order confirmation emails via Supabase Edge Functions.
- No accounts yet — guest checkout only (decision 0004).
