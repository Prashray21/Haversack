# Project Runtime — Product Requirements Document

**Version:** 0.2 (supersedes v0.1) · **Status:** Draft, pre-build · **Date:** November 6, 2026

**Tagline:** Write your project's AI setup once. Sync it to every tool. Enforce it.

## 1. Summary

Project Runtime is a **control plane for AI-assisted software teams**. A team defines its project's context, rules, skills, and tool access once, in a portable `project.yaml`. Project Runtime compiles that definition into the native configuration of every AI tool the team already uses, checks pull requests against the team's rules, keeps project context fresh, and brokers tool access through a permissioned, audited gateway.

It is deliberately **not** another AI workspace. Developers keep working in their editor or terminal. Project Runtime sits underneath and makes every one of those tools behave consistently.

### What changed from v0.1

| v0.1 | v0.2 | Why |
| --- | --- | --- |
| Project-aware chat workspace is the core product | Cut from MVP; the product is a CLI, a GitHub App, and a light dashboard | Developers will not leave their editor for a new chat surface |
| "Reproducible AI environment" | Reproducible **inputs**, with honest limits on outputs | LLM output is non-deterministic, and the Docker analogy overpromises |
| Rules are "available" to the AI | Rules are **enforced** on PRs | Available is not the same as followed |
| Context is versioned | Context is also **kept fresh** from merged work | Stale context is worse than none |
| Integrations and credentials arrive in Phase 5 | A managed MCP gateway is the main long-term moat, in beta by Phase 2 | It is the one capability a file in git cannot provide |
| Targets students, startups, agencies, hackathons | Beachhead is **agencies**; startups follow | Agencies feel the pain most and have the budget |
| MVP: workspace, registry, workflow engine, 4 integrations | MVP: compiler, sync, `check`, GitHub App | Contradicted the v0.1 non-goals |
| No competitor analysis | Included (Section 3) | The biggest gap in v0.1 |

## 2. Problem

Teams that build with AI coding tools configure each tool separately and rarely keep the configurations aligned.

- **Context fragmentation.** Each developer's AI knows a different slice of the project.
- **Inconsistent output.** Different rules and conventions per person and per tool produce inconsistent code.
- **Onboarding cost.** Every new teammate re-creates prompts, tool connections, and conventions by hand.
- **Unenforced rules.** Conventions live in a markdown file the model may half-ignore, and nobody notices until review.
- **Stale knowledge.** Architecture and decisions drift away from what the AI is told.
- **Credential sprawl.** Tokens for GitHub, databases, and design tools get pasted into individual configs with no central permissions or audit trail.

The problem is sharpest for **agencies and consultancies**: many concurrent client projects, rotating developers, and client-specific rules that must not leak between projects.

## 3. Competitive landscape

Much of the v0.1 idea can already be approximated for free. The PRD must be honest about that.

| Approach | What it gives you | Where it falls short |
| --- | --- | --- |
| Shared instruction files in the repo (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, Copilot instructions) | Versioned, free, per-tool context and rules | Each tool has its own format and nothing keeps them in sync. No enforcement, freshness, or permissions. |
| Tool-native team features (org-level skills, plugins, shared rules in individual vendors) | Convenient inside one vendor's ecosystem | Locked to one vendor, and each vendor has a different model. |
| Shared MCP config files | Common tool list | Secrets end up on laptops, with no per-role scoping or audit. |
| Internal wiki or Notion | Human-readable project knowledge | Not machine-actionable and goes stale. |
| Linters, CI, and code review | Enforce deterministic standards | Do not encode AI-specific context or check LLM-written code against intent. |

**Our wedge:** work across all vendors, enforce instead of suggest, and own the credential and permission layer.

**Platform risk:** individual vendors will keep improving native team features. Our defense is neutrality (one definition across tools), enforcement, and the gateway. A vendor will not enforce another vendor's rules or broker access across competitors.

## 4. Vision and positioning

> **Every AI tool on the team behaves like it belongs to the same project.**

Positioning line: *"It works with my AI" becomes "it works with our AI."*

### Principles

1. **Meet developers where they are.** No new editor, no new chat window.
2. **Source of truth in the repo.** `project.yaml` and its files live in git. The dashboard is a view, not the store.
3. **Enforce, don't suggest.** Anything we can check automatically, we check.
4. **Be honest about determinism.** We guarantee consistent inputs, not identical outputs.
5. **Least privilege by default.** Credentials never touch prompts or config files.
6. **Vendor-neutral.** Adding a new AI tool is an adapter, not a rewrite.

## 5. Target users

**Beachhead: software agencies and consultancies** with five or more concurrent client projects and regular developer rotation.

- Buyer: agency owner or engineering lead
- Pain: re-setting-up each project and each new developer; inconsistent quality across clients; client-data separation
- Value: onboarding in minutes, rules enforced across every project, clean per-client isolation

**Second wave:** startups with five or more developers using AI tools heavily. **Later:** mid-size and enterprise teams that need the gateway, audit logs, and SSO.

**Deprioritized:** student and hackathon teams. They have low willingness to pay and different needs.

## 6. Core concepts

- **Project definition:** `project.yaml` plus the context and rules files it references, stored in the repo.
- **Target:** a supported AI tool (for example Claude Code, Cursor, Copilot). Each has an adapter that compiles the definition into its native format.
- **Check:** a rule that can be evaluated against a PR. Either deterministic (static) or LLM-judged.
- **Gateway:** a managed MCP proxy that holds credentials and applies per-role permissions and audit logging.
- **Workspace:** the organization (an agency) containing many projects.

### Example `project.yaml`

```yaml
runtime: 1
project: acme-storefront

context:
  - context/product.md
  - context/architecture.md
  - context/decisions.md

rules:
  - rules/coding.md
  - rules/security.md

targets: [claude-code, cursor, copilot]

integrations:
  github:   { scopes: [read, branch-write] }
  supabase: { scopes: [read] }

checks:
  - id: no-service-role-in-client
    type: static
    severity: block
  - id: rls-required-on-new-tables
    type: llm
    severity: warn

model_policy:
  pin: true   # record the model versions used for checks
```

## 7. Features and requirements

Priority: **P0** = MVP, **P1** = next, **P2** = later.

### F1. Compiler and sync (P0)

Compiles the project definition into each target's native configuration and keeps it in sync.

- F1.1 Adapters for at least three targets at launch.
- F1.2 `runtime sync` regenerates target files from the definition and shows a diff before writing.
- F1.3 Generated files are marked as generated. Hand edits are detected and reported as drift.
- F1.4 Rule priority is respected: project rules override conflicting lower-level instructions, and conflicts are flagged at compile time.
- F1.5 Adapters are versioned and isolated so a new target can be added without touching the core.

### F2. Rules as CI (P0)

A GitHub App evaluates every PR against the project's checks.

- F2.1 **Static checks:** pattern, file-path, and AST-based rules (for example no service-role key in client code, no `console.log` in production code).
- F2.2 **LLM-judged checks:** natural-language rules evaluated against the diff (for example every new table has row-level security).
- F2.3 Severity levels: `block`, `warn`, `info`. Only `block` fails the check run.
- F2.4 Each finding links to the rule, the file and line, and a suggested fix.
- F2.5 A developer can dismiss a finding with a reason. Dismissals are logged, and repeated dismissals of one rule are surfaced as a signal to revise it.
- F2.6 Cost controls: static checks run first, and LLM checks run only on changed files and respect a per-project budget.
- F2.7 `runtime check` runs the same checks locally before pushing.

### F3. Living context (P1)

Keeps context accurate as the project changes.

- F3.1 On merge, propose updates to `decisions.md` and `architecture.md` as a draft PR. A human approves.
- F3.2 Flag context files that reference code paths or components that no longer exist.
- F3.3 Track context changes with history and authorship.

### F4. Managed MCP gateway (P1, beta in Phase 2)

The capability a repo file cannot provide.

- F4.1 Connect integrations once at the project or workspace level through OAuth where possible.
- F4.2 Credentials are stored encrypted. They never appear in prompts or config files.
- F4.3 Per-role and per-tool permissions (for example a reviewer can only read).
- F4.4 Every tool call is logged with who, which tool, and what scope.
- F4.5 Integrations are revocable in one click, and secrets can be rotated.
- F4.6 Strict per-project and per-workspace isolation.

### F5. Onboarding (P0)

- F5.1 `runtime init` scans an existing repo and generates a draft `project.yaml`, context, and rules for the team to review. init must also ingest existing `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules` into `context/` and `rules/` rather than leaving them to conflict with generated files. **Required before MVP exit** — sequenced after the core CLI steps, before any design-partner trial (real repos already have these files).
- F5.2 `runtime join` sets up a new teammate: sync targets, connect the gateway, load context.
- F5.3 Target time from `join` to a working setup: under 10 minutes.

### F6. Dashboard (P0, minimal)

- F6.1 Members and roles.
- F6.2 Integrations and their status.
- F6.3 Check results across projects and an audit log.
- F6.4 Drift report: which developers' tool configs differ from the definition.

### F7. Skills (P1)

Reusable instruction bundles attached to a project and compiled to targets that support skills. A private, per-workspace registry first. A public marketplace is explicitly out of scope until trust and supply-chain controls exist (see Section 10).

## 8. MVP scope (4 to 6 weeks)

**In:** CLI (`init`, `sync`, `check`, `join`), three target adapters, GitHub App running static and LLM checks on PRs, minimal dashboard (members, integrations, check results), `project.yaml` spec v1.

**Out:** chat workspace, workflow engine, agents, skill marketplace, gateway (beta follows MVP), SSO, self-hosting, cloud IDE.

**MVP exit criteria:**

- Three design-partner agencies run it on at least two live projects each.
- A new developer reaches a working setup in under 10 minutes.
- Check false-positive rate under 15 percent on blocking rules.
- `init` ingests existing CLAUDE.md / AGENTS.md / `.cursor/rules` into `context/` and `rules/` (blocking for design-partner trials — see F5.1).

## 9. Architecture

```text
   Developer machines                GitHub
   ┌───────────────┐         ┌──────────────────┐
   │ runtime CLI   │         │ Runtime GitHub   │
   │ (init/sync/   │         │ App (PR checks)  │
   │  check/join)  │         └────────┬─────────┘
   └───────┬───────┘                  │
           │                          │
           ▼                          ▼
   ┌────────────────────────────────────────────┐
   │              Runtime API                   │
   ├──────────────┬──────────────┬──────────────┤
   │ Definition   │ Check engine │ Context      │
   │ + adapters   │ static + LLM │ freshness    │
   └──────┬───────┴──────┬───────┴──────┬───────┘
          │              │              │
          ▼              ▼              ▼
     Target files    LLM gateway    Audit + DB
   (AGENTS.md, etc.) (model-agnostic) (Postgres)

   Phase 2: Managed MCP gateway (credential broker, permissions, audit)
```

- **CLI** is local-first and works offline for `sync` and static `check`.
- **Check engine** runs deterministic rules first and calls a model only for LLM-judged rules, with pinned model versions and a per-project budget.
- **LLM layer** is provider-agnostic, with model versions recorded per check run.
- **Stack (suggested):** TypeScript and Node for CLI and API, PostgreSQL, a Next.js dashboard, a managed secrets store.

## 10. Security and threat model

| Threat | Why it matters | Mitigation |
| --- | --- | --- |
| Token theft from our gateway | We would hold access to many customers' GitHub, database, and design accounts | Encrypted secrets, short-lived scoped tokens, per-project isolation, revocation, rotation, audit logs |
| Prompt injection via context, skills, or PR content | Poisoned content can steer the AI or the LLM-judge | Treat all repo content as untrusted input to the judge, constrain checker output to structured verdicts, no tool access in the checker |
| Malicious or compromised skills | A shared skill is a supply-chain vector | Private registries first, content review and signing before any public registry |
| Cross-tenant leakage | An agency's clients must never see each other's data | Hard tenant isolation in storage and queries, no shared prompts or caches across projects |
| Over-privileged agents | An agent with write access can do real damage | Least-privilege defaults, read-only reviewer role, branch-scoped writes, sandboxing before any autonomous execution |
| Secrets in the repo | Generated files might capture sensitive values | Secret scanning on `sync` and `check`, and never write credentials into generated files |

## 11. Reproducibility, stated honestly

**We guarantee:** every teammate and tool is configured from the same versioned definition, the same rules are checked on every PR, and every check run records the model version, rule version, and context version it used.

**We do not guarantee:** identical model output for identical input. Models change and sampling varies.

To reduce variance, pin model versions for checks, keep rules specific and testable, and measure outcomes (Section 12) instead of claiming determinism.

## 12. Success metrics

| Metric | Definition | Initial target |
| --- | --- | --- |
| Time to first merged PR | New developer join to first merged PR | Under 1 day |
| Setup time | `join` to a working, synced setup | Under 10 minutes |
| Rule catch rate | Violations caught per 100 PRs | Tracked, with a baseline per project |
| First-pass check rate | PRs passing checks on first push | Rising over 60 days |
| Check precision | Share of findings not dismissed as wrong | Over 85 percent on blocking rules |
| Tools in sync | Targets kept in sync per project | Three or more |
| Drift | Share of developers with out-of-sync configs | Under 10 percent |
| Retention | Projects with a check run in the last 30 days | Over 70 percent |

## 13. Business model (hypotheses to validate)

- **Free:** one project, static checks, a small LLM-check allowance.
- **Team:** priced per active project for agencies, with an LLM-check allowance, dashboard, and drift reports.
- **Business:** the managed gateway, audit export, and priority support.
- **Enterprise (later):** SSO, advanced roles, compliance reporting, self-hosting.

The pricing unit (per project, per seat, or per check) is an open question for design-partner interviews.

## 14. Roadmap

| Phase | Focus | Contents |
| --- | --- | --- |
| 1: Foundation | Prove the wedge | CLI, three adapters, GitHub App checks, minimal dashboard |
| 2: Gateway | Build the moat | Managed MCP gateway beta, per-role permissions, audit log, living context |
| 3: Scale | Broaden | More targets, private skill registry, drift reporting, templates |
| 4: Enterprise | Move up-market | SSO, advanced permissions, compliance, self-hosting |
| Later | Revisit only with evidence | Workflow engine, agents, marketplace |

## 15. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Vendors ship native team configuration that is good enough | High | Stay vendor-neutral, lead with enforcement and the gateway |
| LLM-judged checks are noisy and teams turn them off | High | Static checks first, dismissal feedback loop, precision target, per-rule tuning |
| Rule authoring is too hard, so teams write weak rules | Medium | Starter rule packs, `init` that proposes rules from the codebase |
| Adapter maintenance as tools change formats | Medium | Isolated adapters, contract tests, a small supported-target list |
| Trust barrier to granting repo and credential access | Medium | Minimal scopes, open-source CLI, clear security documentation |
| Agencies are a small market | Medium | Treat as a beachhead, with startups and enterprise to follow |

## 16. Open questions

1. Who pays: the agency owner, the engineering lead, or per-client reimbursement?
2. Pricing unit: per project, per seat, or per check?
3. Which three targets ship first, based on design-partner usage?
4. How much of rule authoring can `init` automate reliably?
5. Should the CLI be open source to reduce the trust barrier, with the hosted checks and gateway as the paid layer?
6. What is the minimum viable gateway, and is it better as a standalone product?
7. Managed-region / local-notes — raised 2026-11-06 during MVP planning; explicitly out of scope for now (do not build without validation).

## 17. Non-goals

- A chat workspace or any new editor
- A cloud IDE or an in-house LLM
- A workflow engine or autonomous agent swarm (Phase 4+ only with evidence)
- A public skill or agent marketplace before supply-chain controls exist
- Replacing CI/CD, issue trackers, or code review tools
- Enterprise IAM in the MVP

## 18. Validation plan

1. Interview 15 agencies and consultancies about onboarding cost, rule enforcement, and who owns the decision.
2. Recruit three design partners and ship the MVP to them within six weeks.
3. Measure setup time, check precision, and dismissal rate on real PRs.
4. Decide at week 8: continue, change target segment, or narrow to a single feature (likely Rules as CI or the gateway).

## 19. Implementation decision log (2026-11-06)

Decisions made while building the MVP that refine this PRD. Where this log is more specific than earlier sections, the build follows this log.

| # | Decision |
| --- | --- |
| D1 | Checks are defined inline in `project.yaml` (`id`, `type`, `severity` plus the body: `pattern`/`path`/`exclude` for static, `prompt`/`paths` for LLM), scoped by path globs. The GitHub App evaluates PRs against the **base branch's** `project.yaml`, so a PR cannot weaken its own checks. |
| D2 | Static checks match **added diff lines** by default, not whole files. |
| D3 | `severity` defaults to `warn`. |
| D4 | `model_policy.budget` exists. Unit: USD (2 decimals), computed from token usage × the per-model price recorded at run time. `usd_per_run` caps one check run; `usd_per_month` is per project per calendar month (UTC). Budget exhaustion yields a `skipped`/neutral check result — never a silent pass. |
| D5 | Generated files carry a `GENERATED BY RUNTIME — DO NOT EDIT` header (placement per adapter; after the `.mdc` frontmatter for Cursor). Output is LF-only, and all hashing uses BOM-stripped, LF-normalized content. Drift detection uses a committed `.runtime/manifest.json` (recursively sorted keys, stable formatting, trailing newline) with states: `unchanged`, `stale`, `hand-edited`, `untracked`, `new`. |
| D6 | CLI exit codes: `0` success, `1` changes or drift detected (`sync --verify`), `2` configuration error (including an unknown `runtime:` spec version), `3` secret detected. `sync --verify` replaces `sync --check` to avoid colliding with `runtime check`. |
| D7 | The `integrations` block is validated but inert in the MVP (gateway is Phase 2); loading a config with integrations emits a parse-time warning. |
| D8 | Secret scanning runs on `sync` and `check`. Findings are always redacted (the secret value is never printed). A per-line marker `runtime:allow-secret` skips a line; a project-level `secrets.ignore` list (regex + optional reason) provides repo-wide allowlisting. |
| D9 | MVP targets: `claude-code`, `cursor`, `copilot` (resolves open question 3 for the MVP). |
| D10 | Generated output larger than ~20 KB warns at sync time; an import mode (split + referenced files) is planned for v1.1. |
| D11 | `runtime init` must ingest existing `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` (see F5.1). **Required before MVP exit** — not deferred to v1.1. |
