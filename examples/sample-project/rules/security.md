# Security rules

- The Supabase service-role key must never appear in client code, browser
  bundles, or git. Server routes and Edge Functions only.
- Secrets come from environment variables. Never hardcode keys, tokens, or
  connection strings.
- All user input crossing a trust boundary is validated (Zod schemas in
  `src/lib/schemas/`).
- Client code talks to Supabase with the anon key through RLS policies —
  never through the admin client.
- New SQL tables: enable RLS in the same migration that creates them.
