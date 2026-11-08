# Decision context

The authoritative implementation decision log is `docs/PRD.md` §19 (D1–D13,
2026-11-06). Where this summary and that log disagree, the log wins.

- D1 Checks live inline in `project.yaml` (static: `pattern`/`path`/`exclude`;
  LLM: `prompt`/`paths`), scoped by path globs. The future GitHub App evaluates
  PRs against the base branch's `project.yaml` so a PR cannot weaken its own
  checks.
- D2 Static checks match added diff lines by default; local `runtime check`
  defaults to whole-file mode with `--base <ref>` for diff mode.
- D3 `severity` defaults to `warn`.
- D4 Budget unit is USD (2 decimals); exhaustion yields `skipped`, never a pass.
- D5 Generated files carry a generated header; LF-only output; drift manifest
  `.runtime/manifest.json` with stable formatting.
- D6 Exit codes: 0 ok, 1 changes/drift or block failure, 2 config error,
  3 secret found.
- D7 The `integrations` block validates but is inert in the MVP (gateway is
  Phase 2); loading one emits a parse-time warning.
- D8 Secret scanning on `sync` and `check`; findings always redacted;
  `runtime:allow-secret` marker and `secrets.ignore` allowlist.
- D9 MVP targets: `claude-code`, `cursor`, `copilot`.
- D10 Output over ~20 KB warns at sync time; import mode planned for v1.1.
- D11 `runtime init` must ingest existing CLAUDE.md / AGENTS.md / .cursor/rules.
- D12 CLI and core are MIT; the hosted App and gateway stay private/commercial.
  The repository stays private during the MVP.
- D13 `runtime check` scans git-tracked files; LLM-judged checks report
  `skipped` until the judge exists — never a pass.

## Session plan (2026-11-07)

M0 audit fix ✓ → M1 release plumbing ✓ → M2 dogfood (this file is part of it)
→ M3 hardening → M4 init → M5 join → M6 LLM judge → M7 AGENTS.md gate +
adapters → M8 GitHub App design → M9 release v0.1.0-alpha.1.
