# Product context — Project Runtime

Project Runtime is a control plane for AI-assisted software teams. A team defines
its project's context, rules, skills, and tool access once, in a portable
`project.yaml`. The tool compiles that definition into the native configuration
of every AI tool the team uses, checks pull requests against the team's rules,
and keeps project context fresh.

It is deliberately not another AI workspace: developers keep working in their
editor or terminal. Project Runtime sits underneath and makes every one of those
tools behave consistently.

## Positioning

- Tagline: write your project's AI setup once. Sync it to every tool. Enforce it.
- Beachhead: software agencies and consultancies (5+ concurrent client projects,
  rotating developers). Second wave: startups.
- Wedge: vendor-neutral (one definition across tools), enforcement instead of
  suggestion, and later the credential/permission layer (managed MCP gateway).

## MVP scope (PRD v0.2 §8)

In: CLI (`init`, `sync`, `check`, `join`), three target adapters, GitHub App
running static and LLM checks on PRs, minimal dashboard, `project.yaml` spec v1.

Out (for the MVP): chat workspace, workflow engine, agents, skill marketplace,
gateway (beta follows MVP), SSO, self-hosting, cloud IDE.

## This repository dogfoods the product

The root `project.yaml` describes this repo itself; `runtime sync` generates
tool configs from it and `runtime check` enforces its rules on the codebase.
If the product cannot keep its own house in order, that is a bug — report it,
do not work around it.
