# Contributing to SceneMD

SceneMD’s differentiator is the deterministic document-to-scene planner. Contributions should preserve the document-first boundary: Markdown remains canonical, the planner owns pagination, and the renderer only renders `Scene[]`.

## Development

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run lint
npm test
npm run typecheck
npm run build
```

CI runs exactly these four, in this order, plus the browser smoke test.

### The typecheck runs two compilations

`npm run typecheck` is `tsc -b` **and** `tsc -p tsconfig.cloudflare.json`. The first covers `src/` with DOM types; the second covers `functions/` and `worker/` with `@cloudflare/workers-types`. Running `tsc -b` by hand — or trusting an editor that only loads the root project — leaves the entire backend unchecked. If you touched `functions/` or `worker/`, make sure the second compilation actually ran.

### Tests

```bash
npm test                       # everything
npx vitest run src/engine      # one directory
npx vitest run worker/merge.test.ts   # one file
npm run test:watch             # watch mode
```

Test expectations are derived from the contracts in `spec.md`, not recorded from output. When a test fails, the question is "which behavior diverged from the specification", not "did the output change". Never fix a failing test by pasting in the new output — if the spec moved, change the spec in the same pull request.

`test/corpus/` plans every fixture document across four viewport classes and three density modes and asserts the critical invariants from the spec's Evaluation section. Its `KNOWN_GAPS` set is a ratchet of currently-violating combinations: entries must keep failing (a fix forces the entry out), and anything not listed must pass. Do not add entries to make CI green — an addition means you introduced a new invariant violation.

### Browser smoke test

```bash
npm run build
npm run smoke
```

Self-contained: it launches the full local stack (`wrangler pages dev` with local D1, R2, and the DocumentRoom Durable Object) and a headless Chrome, then drives the app over CDP. No manual setup. `SCENEMD_TEST_URL` / `SCENEMD_CDP_URL` attach to already-running processes instead; `CHROME_PATH` overrides browser detection.

It asserts against real selectors (`.cm-editor`, `.markdown-mode-button`, `.documents-hero`, …), so renaming UI classes means updating `tools/browser-check.mjs` in the same change — CI runs it and will tell you.

### Local Cloudflare state

The Vite dev server (`npm run dev`) runs without any Cloudflare services; document persistence, image upload, Workers AI, and HackMD sync will be unavailable but the editor and planner work fully. For the persistence stack locally:

```bash
npm run db:migrate:local       # apply migrations/ to the local D1 (.wrangler/state)
npx wrangler pages dev -c wrangler.jsonc -c worker/wrangler.jsonc
```

The two `-c` flags matter: the Pages config binds the `DocumentRoom` Durable Object from the separate `scenemd-live` Worker, and only a multi-config dev session resolves that binding locally.

Keep pull requests focused. For planner changes, explain which semantic constraint or score changes and test the effect across wide and narrow viewports.

A pull request that changes what the product does updates `README.md` and `spec.md` in the same change. Documentation that lags behind behavior is how the specification came to list an implemented feature as a non-goal.

## Dependencies

Dependabot opens grouped update pull requests weekly. Groups are defined in [`.github/dependabot.yml`](.github/dependabot.yml) and exist so that packages which must move together are reviewed together.

Some dependencies are pinned to exact versions rather than caret ranges. This is deliberate:

- **`unified`, `remark-parse`, `remark-gfm`, `remark-math`, `katex`.** `src/engine/semantics.ts` reads mdast node shapes directly, and KaTeX output height feeds the measurement pass that drives pagination. A minor release that changes either can move every scene boundary in a document without any type error.
- **`react`, `react-dom`, `@types/react`, `@types/react-dom`.** Kept in lockstep to avoid type/runtime skew.
- **`typescript`, `vite`, `@vitejs/plugin-react`.** Build reproducibility.

When updating any pinned package, check the effect on pagination rather than only that the build passes.

### Cloudflare compatibility date

`compatibility_date` appears in **two** files and they must stay in sync:

- `wrangler.jsonc` — the Pages project
- `worker/wrangler.jsonc` — the `scenemd-live` Worker

The same applies to `database_id`: both configs bind the same D1 database, so changing one without the other splits the deployment across two datastores.

## Design principles

- Prefer coherent under-filled scenes over crowded scenes.
- Never split image-caption pairs or display math.
- Keep the deterministic core independent of Workers AI.
- Preserve source ranges and content-derived identities.
- Treat manual presentation directives as escape hatches, not the default workflow.

### The measurement contract

Pagination is driven by real rendered heights: `App.tsx` renders every block inside a hidden measurement root and reads `offsetHeight` from each `[data-measure-id]` element into the map that `planScenes` consumes. `BlockView` and `SceneView` accept a `measurement` prop; when it is true, stepped reveals, hidden highlight states, and any other conditional rendering must render **fully visible**, so the measured height is the block's maximum.

This is the easiest contract in the codebase to break by accident: a new conditional rendering path that ignores the `measurement` flag under-measures the block, and the resulting bug looks like a planner bug — scenes overflow at presentation time while every planner test stays green. If you add conditional rendering to a block, ask what the measurement pass should see, and make the `measurement` branch render it.

By contributing, you agree that your contributions will be licensed under the MIT License.
