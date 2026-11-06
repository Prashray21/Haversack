# Process rules

## Evidence

- "Done" requires evidence: a file path plus a passing test name or pasted
  command output. No evidence means not done.
- Never invent external facts (tool config formats, API behavior). Implement
  only what official documentation supports; otherwise mark the work as blocked
  and say what is needed to unblock it.

## Workflow

- One milestone at a time; small commits with conventional prefixes.
  After each milestone: typecheck, tests, audit update, checkpoint, then stop
  and wait for the word to continue.
- Stop and report instead of retrying when a command exceeds five minutes, the
  same failure repeats, credentials are missing, or an external format is
  uncertain.
- No force pushes. The repository stays private. Outward-facing actions are
  confirmed first.

## Bugs

Every found bug follows the same loop: failing regression test first, root-cause
fix (not a symptom patch), a guard that prevents the class of bug from
recurring, and an entry in `docs/BUGS.md` with cause, fix, and test name.

## Secrets

Credentials come from the environment, never from files, and are never logged.
Secret findings are always redacted in any output path, including error
messages and verbose logs.
