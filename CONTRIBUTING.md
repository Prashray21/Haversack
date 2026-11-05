# Contributing

The repository is **private during the MVP** — internal contributors only for now. This document describes the ground rules that make PRs fast to review.

## Setup

```sh
corepack enable pnpm   # or: npm i -g pnpm
pnpm install
pnpm build
pnpm test
```

Node >= 20. TypeScript strict, ESM, Vitest.

## Ground rules (from the PRD)

1. **Small, reviewable steps.** One logical change per PR; stop and summarize.
2. **Tests for every adapter and every check type** before moving on.
3. **Adding a target = one adapter file + one registry line + its tests.** If a change touches core to add a target, the abstraction leaked.
4. **No new dependencies without written rationale.** State why, size, and what it replaces.
5. **Never commit real secrets.** Test fixtures use obviously-fake values; the pre-push audit is `node scripts/scan-secrets.mjs` (it exits 1 with known fixture findings — review the output; no real values may appear).
6. Generated files are produced by `runtime sync` only; commit the regenerated files **and** `.runtime/manifest.json` together.
7. LF only — `.gitattributes` enforces it; all hashing is on LF-normalized content.

## PR checklist

- [ ] `pnpm typecheck && pnpm build && pnpm test` green locally
- [ ] New behavior has tests (including the Windows CI run)
- [ ] Behavior decisions recorded in `docs/PRD.md` §19 (D-numbers)
- [ ] Exit codes and user-facing output updated in the README if changed

## Commits

Imperative subject ≤ 72 characters (`feat(core): ...`, `fix(cli): ...`, `docs: ...`, `chore: ...`).
