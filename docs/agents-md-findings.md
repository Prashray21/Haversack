# AGENTS.md research + shared-output proposal (M7, F1.1, D9)

Researched 2026-11-07 from official sources only. Every claim below carries
its citation. Where a format could not be verified from an official doc, the
adapter is marked blocked — none are.

## Sources

1. **agents.md** (the format's own site, stewarded by the Agentic AI
   Foundation / Linux Foundation) — <https://agents.md/>
2. **Cursor docs, Context → Rules** — <https://cursor.com/docs/context/rules>
3. **GitHub Docs, Customizing Copilot → repository custom instructions** —
   <https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot>

## Finding 1 — who reads AGENTS.md (source 1)

AGENTS.md is "a README for agents": standard Markdown, no required fields or
frontmatter. Tools listed by the site include Codex (OpenAI), Jules (Google),
Factory, Aider, goose, opencode, Zed, Warp, VS Code, Devin (Cognition),
UiPath Autopilot, Junie (JetBrains), Amp, **Cursor**, RooCode, Gemini CLI,
**GitHub Copilot's coding agent**, Ona, Windsurf, Augment Code.

Discovery: place `AGENTS.md` at the repo root; agents locate the nearest file
in the tree. Monorepo hierarchy: "The closest AGENTS.md to the edited file
wins; explicit user chat prompts override everything."

## Finding 2 — Cursor formats (source 2)

- Project rules: `.cursor/rules/*.mdc` (subfolders allowed; filename
  arbitrary; plain `.md` is ignored — "has no frontmatter to specify
  `description`, `globs`, and `alwaysApply`").
- Frontmatter semantics (exact, from the docs' interaction table):
  - `alwaysApply: true` → "Always included. Globs and description are
    ignored."
  - `alwaysApply: false` + `globs` → auto-attached when a matching file is in
    context.
  - `alwaysApply: false` + `description` → agent decides from the description.
  - none → manual `@`-mention only.
- `globs` supports comma-separated patterns, `*` and `**`.
- **AGENTS.md is natively supported** at root and nested; nested instructions
  combine "with more specific instructions taking precedence".
- Precedence: "Team Rules → Project Rules → User Rules."
- Best practice: keep rules under 500 lines; reference files rather than
  copying contents.

## Finding 3 — GitHub Copilot formats (source 3)

- Repository-wide instructions: **`.github/copilot-instructions.md`** — plain
  Markdown, added automatically to every request in the repo's context.
- Path-specific: `.github/instructions/NAME.instructions.md` (subdirectories
  allowed), frontmatter `applyTo: "glob"` (comma-separated globs supported),
  optional `excludeAgent: "code-review" | "cloud-agent"`.
- If both exist, instructions from both are applied. Priority: personal >
  repository > organization.
- **AGENTS.md: Copilot's agents read it** — "one or more AGENTS.md files,
  stored anywhere within the repository", "the nearest AGENTS.md file in the
  directory tree will take precedence". A single root `CLAUDE.md` or
  `GEMINI.md` is also accepted by the coding agent.
- Note: "For code review, Copilot reads instructions from the head branch,
  not the base branch."

## Shared-output proposal

All three MVP targets consume the SAME definition (context + rules), so the
compiled artifacts stay byte-consistent across tools by construction:

| Target | Output | Format decision (cited above) |
| --- | --- | --- |
| `claude-code` | `CLAUDE.md` (existing) | plain markdown, generated header prepended |
| `cursor` | `.cursor/rules/runtime.mdc` | frontmatter **first**, generated header **after the frontmatter** (D5; matches the documented `.mdc` structure — plain `.md` would be ignored). `alwaysApply: true` because the compiled context+rules are the project's always-on baseline ("Always included"). |
| `copilot` | `.github/copilot-instructions.md` | plain Markdown (repo-wide instructions file; documented name and location), header prepended, no frontmatter (none is documented for this file) |

One file per target, deterministic bytes, drift-manifested like `CLAUDE.md`.

**AGENTS.md gate (the question this research answers):** we do NOT emit
`AGENTS.md` in the MVP. Rationale:

1. Two of our three targets natively read their own config (Cursor reads
   `.cursor/rules`; Copilot reads `.github/copilot-instructions.md`), and the
   Claude adapter writes `CLAUDE.md` — which Copilot's coding agent accepts as
   a fallback and Cursor reads as AGENTS-style context. A fourth file
   duplicating the same content would only add drift surface.
2. **Proposal for v1.1:** add an `agents-md` target for the tools that read
   AGENTS.md natively and have no other config we generate (Codex, Gemini CLI,
   Jules, Zed, …). The adapter is trivial (plain markdown + header) and the
   format research above is already done. The decision for the App/dashboard
   era: per-tool *targets* stay explicit in `project.yaml` so teams see
   exactly which files are Runtime-managed.
3. Ingestion (`runtime init`, M4) already moves an existing root `AGENTS.md`
   into `rules/` so a generated file can never conflict with it (F5.1).

## What we implemented against these findings

- Cursor adapter emits `.cursor/rules/runtime.mdc`: `alwaysApply: true`
  frontmatter, then the generated header, then context + rules inlined.
- Copilot adapter emits `.github/copilot-instructions.md`: generated header,
  then context + rules inlined.
- Both are registry-isolated (F1.5), versioned, and covered by contract tests
  including the header-after-frontmatter placement for `.mdc`.
