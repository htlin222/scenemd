<!--
Keep pull requests focused and single-purpose. Describe why, not what —
the diff already says what changed.
-->

## Why

<!-- The problem being solved. Link the issue: Closes #123 -->

## Verification

<!--
`npm run typecheck` runs TWO compilations: tsc -b covers src only, and
tsconfig.cloudflare.json covers functions/ and worker/. Running tsc -b
directly leaves the backend unchecked. See CONTRIBUTING.md.
-->

- [ ] `npm run typecheck`
- [ ] `npm run build`

<!-- Delete the sections below that do not apply. -->

## Planner or semantics changes

- [ ] States which semantic constraint or score term changed, and why
- [ ] Checked at a wide viewport and a narrow viewport
- [ ] Checked in every density mode affected (Compact / Balanced / Cinematic)
- [ ] No regression against the stated invariants: no split image-caption pairs, no unintentional hard overflow, no main content below 20px
- [ ] Scene boundaries stay stable across a minor edit (the `stability` term exists to prevent reflow during rehearsal)

## Backend changes

- [ ] Type-checked under `tsconfig.cloudflare.json`
- [ ] Migrations added under `migrations/` and applied locally (`npm run db:migrate:local`)
- [ ] No secret added to `wrangler.jsonc` or `worker/wrangler.jsonc` — Worker secrets only
- [ ] `compatibility_date` and `database_id` still match across both wrangler configs

## Product behavior changes

If this changes what the product does, the documents describing it change in the same PR — otherwise they drift, which is how `spec.md` came to list an implemented feature as a non-goal.

- [ ] `README.md` feature list and project status updated
- [ ] `spec.md` updated where the thesis, non-goals, or engine contract moved
