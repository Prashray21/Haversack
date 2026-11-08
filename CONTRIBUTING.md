# Contributing

Contributions are welcome — this repo is public and MIT-licensed. The product
direction is governed by [docs/PRD.md](docs/PRD.md) (v0.3: a desktop app where
a team shares skills and MCP servers); check it and
[docs/BUILD_PROGRAM.md](docs/BUILD_PROGRAM.md) before proposing features so
PRs land in the same direction.

## Setup

```sh
corepack enable pnpm   # or: npm i -g pnpm
pnpm install
pnpm build
pnpm test
```

Node >= 20. TypeScript strict, ESM, Vitest. The desktop app lives in
`apps/desktop` (`pnpm --filter @haversackhq/desktop build && pnpm --filter @haversackhq/desktop start`).

## Ground rules

1. **Small, reviewable steps.** One logical change per PR; stop and summarize.
2. **Tests first for engine behavior.** Every adapter, ingest guard, and
   install path has tests in the same commit as the change; adversarial cases
   (path escapes, hostile archives, secrets) are required, not optional.
3. **Adding a target = one adapter file + one registry line + its tests.** If a
   change touches core to add a target, the abstraction leaked (ADR 003 §3).
4. **No new dependencies without written rationale.** State why, size, and
   what it replaces.
5. **Never commit real secrets.** Test fixtures use obviously-fake values; the
   secret gate runs in CI on every push and blocks on any finding. Report a
   security issue via [SECURITY.md](SECURITY.md), never a public issue.
6. Generated dogfood files (`CLAUDE.md`, `.cursor/rules/`,
   `.github/copilot-instructions.md`) are produced by `haversack sync` only;
   commit the regenerated files **and** `.haversack/manifest.json` together.
   Never edit `.claude/settings*`, `~/.claude.json` outside `mcpServers`, or
   `~/.claude/skills/synced/` (ADR 003 §1.3 never-touch list).
7. LF only — `.gitattributes` enforces it; all hashing is on LF-normalized
   content.

## PR checklist

- [ ] `pnpm build && pnpm typecheck && pnpm test` green locally (build first — the CLI typechecks against core's dist)
- [ ] New behavior has tests (including the Windows CI run)
- [ ] Decisions recorded: engine behavior → ADR or PRD; user-facing output changes noted
- [ ] `docs/PROGRESS.md` not needed for PRs — the maintainer maintains the ledger

## Commits

Imperative subject ≤ 72 characters (`feat(core): ...`, `fix(cli): ...`,
`fix(desktop): ...`, `docs: ...`, `chore: ...`).
