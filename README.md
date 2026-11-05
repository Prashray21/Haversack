# Project Runtime

Write your project's AI setup once. Sync it to every tool. Enforce it.

A control plane for AI-assisted dev teams — see [docs/PRD.md](docs/PRD.md).

## Layout

| Path | What |
| --- | --- |
| `packages/core` | `project.yaml` v1 schema, parser, adapter interface, drift + secret scanning |
| `packages/cli` | the `runtime` command (`init`, `sync`, `check`, `join`) |
| `apps/github-app` | PR checks (static + LLM-judged) — not implemented yet |
| `examples/sample-project` | demo fixture for `runtime sync` |

## Develop

```sh
corepack use pnpm@latest   # or: npm i -g pnpm
pnpm install
pnpm build
pnpm test
```
