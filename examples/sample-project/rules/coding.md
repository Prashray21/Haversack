# Coding rules

- TypeScript strict mode; no `any` without a comment explaining why.
- Named exports only — no default exports.
- Components in `app/` are Server Components unless they need state or effects.
- Errors are handled, never swallowed: no empty catch blocks.
- Tests live next to the code they cover (`*.test.ts`).
- Commit messages: imperative, under 72 characters.
