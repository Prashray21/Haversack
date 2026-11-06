# GitHub App design — Rules as CI (design only, no code)

Status: design for the MVP's F2 feature set ("A GitHub App evaluates every PR
against the project's checks", F2.1–F2.5) and the budget ledger (D4). Written
2026-11-07 after M2–M7 built the local engine this App will reuse.

## 1. What the App runs

The App is a thin wrapper around `packages/core`'s engine. No check logic
lives in the App: it loads the definition, runs static checks (pure), runs
LLM checks through the same judge (F2.2), and renders findings as GitHub
check runs. The reuse contract is `runStaticChecks` + `runJudge` +
`hashCheckBody` — the same code `runtime check` exercises locally, so a PR
can never fail locally and pass remotely on different rules.

## 2. Webhook flow

```
PR opened/synchronize (push to the PR branch)
        │  X-Hub-Signature-256 (HMAC-SHA256 with the App's webhook secret)
        ▼
webhook receiver (stateless HTTP endpoint)
  1. verify signature (timing-safe compare), reject non-2xx on mismatch
  2. respond 202 immediately; process asynchronously (check runs take seconds;
     GitHub requires a response or re-delivers)
  3. fetch the PR's BASE branch project.yaml + context/rules via the
     Contents API (D1: a PR cannot weaken its own checks)
  4. fetch the head branch's changed files (compare API: files + patches)
  5. compute added lines per file (D2 semantics — same parser as local --base)
  6. run static checks (in-process, pure)
  7. run LLM checks for changed files matching `paths`, respecting the budget
     ledger (section 6)
  8. create a check run ("runtime/check") with conclusion + annotations
```

Events subscribed: `pull_request` (opened, synchronize, reopened).
`check_suite`/`check_run` events are not needed for the MVP.

Idempotency: each delivery is keyed by (`installation`, `pull_request`,
`head_sha`); re-delivery or a re-push replaces the pending check run (GitHub
deduplicates on `name` + `head_sha`).

## 3. Signature verification and auth

- **Webhook signature:** HMAC-SHA256 over the raw body with the app webhook
  secret, compared timing-safe; the raw body must be read before any JSON
  parse. Reject without processing on mismatch.
- **App authentication:** GitHub App private key (PEM, stored in the secrets
  manager) → installation tokens (`GET /app/installations` → `POST
  /app/installations/{id}/access_tokens`). Tokens live ~1 h and are scoped to
  the installation's repositories.
- **Minimum permissions (Contents: read, Checks: write, Pull requests: read):**
  - Contents: read — fetch `project.yaml`, context/rules, and file contents
    from both branches.
  - Checks: write — create check runs and annotations. Nothing else writes.
  - Pull requests: read — list changed files for a PR.
  - Metadata: read — mandatory, implicit.
  - **No** write access to code, issues, or statuses. The App can never
    modify a repository.
- Subscription: all repositories (agency-friendly: one install covers many
  client repos) with per-installation tenant isolation (section 7).

## 4. Checks against the BASE branch's project.yaml (D1)

The definition (and the context/rules files it references) is fetched from
`refs/heads/<base_branch>` of the PR, not from the merge commit or the head.
A PR therefore cannot edit its own `project.yaml` to disable or weaken the
checks that judge it. The definition's `definitionHash` (already computed by
`loadProject`) and every check's `bodySha256` are recorded in the check-run
output — a PR that changes the BASE definition shows up as a changed
rule-hash set in the next PR that targets the new base.

## 5. Check runs, annotations, dismissals (F2.3, F2.4, F2.5)

- One check run named `runtime/check` per PR head SHA; conclusion:
  - `success` — no block-severity failures (warn/info findings still reported)
  - `failure` — ≥1 block-severity check failed (F2.3: only `block` fails)
  - `neutral` — every check was skipped (no files in scope, budget exhausted,
    judge unavailable): skipped is never a pass (D13)
- Output (summary + details): the same render the CLI prints, plus per-check
  `bodySha256` and, for LLM checks, `usage` (model, tokens, USD).
- **Annotations** (max 50 per run; the MVP truncates with a visible note):
  - file/line from the finding; `block` → `failure` level, `warn` → `warning`,
    `info` → `notice`
  - annotation message: the rule id + message; the suggested fix goes in the
    annotation `raw_details` / the check-run summary (F2.4 links rule →
    file/line → fix)
- **Dismissals (F2.5):** a reviewer can dismiss a finding with a reason. The
  MVP stores dismissals in the App's database (section 6): key = (repo,
  check `bodySha256`, file, line-hash of the finding). A dismissed finding
  renders as `notice` with "dismissed by @user: <reason>" and never affects
  the conclusion. Repeated dismissals of the same `bodySha256` surface in the
  drift dashboard as a rule-quality signal (F2.5's "revise the rule" loop).
  Dismissal state is keyed on the rule-body hash, not the rule id, so editing
  a rule invalidates stale dismissals (a dismissed rule must be re-dismissed
  after it changes — deliberate friction).

## 6. Server-side budget ledger (D4)

- Storage: one ledger row per (installation, repo, UTC month):
  `{inputTokens, outputTokens, usdCents}` — integer cents, as in the local
  ledger (`packages/core/src/llm/ledger.ts`).
- The check price is computed from the run's recorded token usage and the
  prices configured in that repo's `model_policy.budget` (D4: "the per-model
  price recorded at run time").
- Gates, in order: `usd_per_month` exhausted → LLM checks `skipped`
  (`budget_exhausted`), static checks always run; `usd_per_run` exceeded →
  the verdict is suppressed to `skipped` but the spend is still recorded (the
  same post-hoc rule the CLI implements).
- The server ledger is authoritative; local CLI ledgers are per-machine
  bounds only.

## 7. Tenant isolation

- Every query and cache key carries `installation_id`; no cross-installation
  reads exist in the data model (row-level scoping in Postgres, enforced in
  the repository layer, tested by an invariant test that a query without an
  installation scope fails).
- No shared prompt caches across projects (PRD §10: no cross-tenant leakage);
  the LLM judge gets per-request state only.
- Per-installation rate budgets so one noisy tenant cannot starve others
  (per-installation token bucket in front of the judge).
- Secrets: webhook secret, app private key, and any LLM keys live in the
  platform's secret store; the LLM key is per-deployment, never per-tenant,
  and tenant usage is bounded by their own budgets.

## 8. Hosting options

| Option | Cost/complexity | Notes |
| --- | --- | --- |
| **Serverless function (Cloudflare Workers / Lambda)** — recommended start | ~$0–5/mo at MVP scale; lowest ops | Stateless webhook processor; queue via the platform's task queue; DB = hosted Postgres (Neon/Supabase free tier). Cold starts are fine (202 response first). |
| Small VPS / container (Fly.io, Railway) | ~$5–20/mo; one process to babysit | Simple long-running worker for LLM calls (avoids function timeouts); still one box, backup = Postgres dump. |
| Managed queue + workers (SQS/Cloud Tasks + containers) | ~$20–50/mo; more moving parts | The right shape once design partners push volume; not needed for 3 design partners. |

MVP recommendation: serverless receiver + one small worker + hosted Postgres.
The webhook receiver and the check worker share `packages/core`, so the App
repository stays thin (receiver, auth, rendering, ledger — realistically
1.5–2k lines including tests).

## 9. Build plan (realistic, single developer)

| Day | Work |
| --- | --- |
| 1 | App registration, webhook receiver + signature verification, installation-token fetch, `202 + queue` skeleton |
| 2 | Fetch base-branch definition via Contents API; load + validate; fetch PR files + added-line computation |
| 3 | Run static checks; render check run + annotations (block/warn/info levels, 50-cap) |
| 4 | LLM checks through `runJudge` with the server-side ledger; skip/reason semantics |
| 5 | Dismissals store + rendering; repeated-dismissal signal; tenant-scope invariant tests |
| 6 | Ops: retry/re-delivery handling, rate-limit backoff, structured logging (no secrets), dead-letter for poison deliveries |
| 7 | End-to-end tests against a real sandbox repo + hardening pass (the M3 checklist applied to the App) |

~7 focused dev-days after M9, plus a review buffer. Explicitly out of scope
for the App MVP: dashboards (F6), living context (F3), gateway (F4).

## 10. Open questions for the owner

1. **Check name/branding** — `runtime/check` vs a product name; affects
   branch-protection docs (which check do teams require?).
2. **Fail vs neutral for "judge unavailable"** — D13 says skipped is never a
   pass; should a `neutral` conclusion on an LLM-only repo block merges under
   branch protection? (Recommend: teams require the check but treat neutral
   as pass-through, configurable per repo at the App level.)
3. **Dismissal persistence location** — App database (proposed) vs committing
   dismissal decisions to the repo (`.runtime/dismissals.json`, reviewable in
   PRs). The repo-file option is auditable but creates merge noise.
4. **LLM key ownership** — one deployment-wide OpenAI key (proposed MVP) vs
   per-installation keys brought by agencies (cost attribution + rate
   isolation, more onboarding friction).
5. **Pricing hook** — D4 budget caps exist per project; do we also need a
   hard global spend ceiling per installation for the free tier?
6. **Monorepo scope** — one `project.yaml` per repo is the MVP; nested
   definitions (like nested AGENTS.md, nearest-wins) are a v1.1 question that
   affects the App's definition fetch.
