# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

React 19 + TypeScript 7 + Vite 8 on the frontend; Cloudflare Pages (static `dist/` + Pages Functions), a separate `scenemd-live` Worker with a Durable Object, D1, R2, and Workers AI on the backend. Markdown parsing is unified/remark; math is KaTeX.

## Commands

```bash
npm run dev                 # Vite dev server (works without Cloudflare bindings)
npm run typecheck           # BOTH projects — see note below
npm run build               # tsc -b && vite build
./tools/deploy.sh           # build → D1 remote migrate → Worker deploy → Pages deploy
npm run db:migrate:local    # apply migrations/ to the local D1
npm run db:migrate:remote
```

`npm run typecheck` runs **two** compilations: `tsc -b` (the `src` app, DOM libs) and `tsc -p tsconfig.cloudflare.json` (`functions/` + `worker/`, `@cloudflare/workers-types`). Server code is not covered by `tsc -b` alone, so always run the full script.

Tests are vitest (`npm test`, `*.test.ts` beside the source). CI (`.github/workflows/ci.yml`) runs `lint → test → typecheck → build` plus the browser smoke test as a second job, on `main` and PRs.

`tools/browser-check.mjs` is the smoke test: self-contained (launches `wrangler pages dev` with local D1/R2/DO plus a headless Chrome; `SCENEMD_TEST_URL` / `SCENEMD_CDP_URL` attach to running instances instead), asserts on DOM selectors, and writes screenshots into `artifacts/`. It fails if selectors like `.documents-hero h1`, `.cm-editor`, or `.figure-bg-panel` change — update the script alongside such UI renames.

The HackMD token is a Worker secret and must never enter either wrangler config:

```bash
npx wrangler secret put HACKMD_API -c worker/wrangler.jsonc
```

## Architecture

### The pipeline

```
markdown
  → parsePresentationDocument()   src/engine/semantics.ts   → PresentationBlock[]
  → buildSemanticRegions()        src/engine/semantics.ts   → SemanticRegion[]
  → planScenes()                  src/engine/planner.ts     → ScenePlan (Scene[])
  → withPresentationCover()       src/engine/planner.ts
  → <SceneView>                   src/components/SceneView.tsx
```

`src/engine/types.ts` is the contract for every stage. The load-bearing boundary is `PresentationAST → Scene[]`; Markdown is just the current frontend.

### Measurement loop (the non-obvious part)

`App.tsx` renders a hidden `.measurement-root` containing every block at the live viewport width, then reads `offsetHeight` from every `[data-measure-id]` / `[data-measure-item-id]` node into a `Map<blockId, height>` that is passed to `planScenes`. Pagination is therefore driven by real rendered heights; `blockHeight()` in the planner is only a fallback for unmeasured blocks.

`BlockView` / `SceneView` take a `measurement` prop. When true, stepped reveals and `hide` highlight states render fully visible so the measured height is the block's maximum. Any new conditional rendering inside a block must respect this flag or pagination will silently under-measure.

### Regions and scenes

- `buildSemanticRegions` flushes a region at every H1/H2/H3 or `breakBefore === 'always'`; an H1 also flushes *after* itself, so H1s become standalone chapter scenes. `headingPath` feeds breadcrumbs and chapter navigation.
- `planScenes` emits one scene per region when the region fits under the density's `comfortable` ratio. Otherwise it runs a greedy window (≤8 blocks of lookahead), scores each candidate via `ScoreBreakdown`, drops candidates that overflow, and takes the highest total.
- Blocks taller than the capacity are pre-split by `continuationParts` per type (paragraph/blockquote inline splitting on word and punctuation boundaries, list items, code lines, table rows repeating the header, columns). Parts get `-part-N` ids and `keepWithPrevious`.
- The `stability` score rewards break points that matched the previous plan, which is what keeps scenes from reflowing wildly on resize. Preserve `previousPlanRef` threading when touching the planning effect.
- `chooseLayout()` derives the layout (`chapter`/`text`/`text-media`/`media-dominant`/`legend`/`statement`) from block composition. Authors do not pick layouts.
- Figure scenes have exactly one layout (design v5, `docs/plans/2026-08-14-image-config-design.md`): optional heading, then figure left / body text right. Position decides text roles — prose above the figure is body copy (it shrinks via `figureTextScale`, floor 0.6, rather than leaving the page); consecutive paragraphs below the figure are its legend and stay with it. `size=NN%` is a fraction of the figure column (the height under the heading), resolved by CSS percentages so planner and renderer share one formula, and clamped to 15–100% on parse and write. `{bg}` (design v5.1, `docs/plans/2026-08-15-figure-bg-design.md`) is the full-bleed alternative: the figure becomes a right-side panel spanning the full content height — top edge right under the chrome strip — bleeding to the scene's right and bottom edges, never cropped, width from the image's aspect ratio capped at 62% of the scene; everything textual (heading, body, legend, captions) moves to the left column, and the figure costs the planner's vertical budget nothing (left-column heights are scaled by `BG_TEXT_WIDTH_FACTOR` to compensate for the narrower column). The write vocabulary is `{size=NN%}` or `{bg}` (mutually exclusive); width/height/fit/filter/layout and Marpit alt tokens are read-compat and normalize away on a dialog save (hero maps to `size=100%`, Marpit `bg` spellings map to `{bg}`). `<!-- present: group -->` … `<!-- present: end-group -->` still hard-binds arbitrary blocks to one scene.

### Backend split

Two deployables share one D1 database (`scenemd-documents`, same `database_id` in both wrangler configs):

- **`functions/api/[[path]].ts`** — Pages Functions, the public HTTP boundary. Owns document list/create in D1, share tokens (only the SHA-256 hash is stored; the plaintext token is returned once), R2 image upload/serve under `/api/images/...`, DOI/PMID citation formatting, and the OpenEvidence fetch proxy (https + host allowlist + `/ask/` path check). Everything else — `/ai/*`, per-document GET/PATCH/DELETE, `/hackmd` — is forwarded to the Durable Object stub.
- **`worker/index.ts`** — the `scenemd-live` Worker exporting the `DocumentRoom` Durable Object (one instance per document id via `getByName(id)`). Owns document state, revision-based optimistic concurrency with a 3-way `mergeMarkdown` (returns 409 when the same span changed in two sessions), HackMD pull/push/smart sync, and Workers AI calls. `HACKMD_API` exists only here.

The DO caches state in its own SQLite storage but D1 remains the durable record — every mutation writes both. Document owner comes from the `Cf-Access-Authenticated-User-Email` header injected by Cloudflare Access.

### Client routes

`parseRoute` in `App.tsx` handles `/`, `/document/:id`, `/share/:token` client-side; `public/_redirects` provides the SPA fallback. Share routes are read-only.

Vite emits `version.json` with the build timestamp (`deployVersionPlugin`), served `no-store` via `public/_headers`; the app polls it against `__SCENEMD_BUILD_TIME__` to warn editors about a newer deploy.

## Conventions

- `SceneView.tsx` renders only. Pagination logic belongs in `planner.ts`, semantics in `semantics.ts`.
- Keep the planner deterministic and independent of Workers AI. AI features (Make bullets, transcript) are editor conveniences; nothing in the pipeline may require them.
- Block ids are content hashes and `sourceRange` is carried end to end — both drive editor ↔ scene scroll sync and plan stability. Do not regenerate ids from array indices alone.
- Prefer a semantic break or an under-filled scene over shrinking type or crowding.
- Presentation hints are HTML comments applied to the next block and are hard constraints: `present: break | keep | hero | hide | only | step`, plus the column group `present: columns [n]` / `present: column` / `present: end-columns` and the same-scene group `present: group` / `present: end-group`. Other `<!-- -->` comments become speaker notes.
- Image config uses the hybrid syntax `![alt](url){key=value …}` (`src/imageSyntax.ts`, design in `docs/plans/2026-08-14-image-config-design.md`): bracket text is verbatim alt, the attribute block is the only config source, and text sharing the image's paragraph is the legend. Legacy Marpit alt tokens are still read when no attribute block exists, but every rewrite (figure dialog included) emits hybrid syntax. Clicking image syntax in the editor opens the full-screen figure dialog (`src/components/FigureDialog.tsx`): a 16:9 canvas where `size` (fraction of scene height) is dragged directly, plus a "Full bleed (bg)" toggle; the planner computes sized-figure heights arithmetically instead of measuring them. `parseImageAttributes` / `formatImageAttributes` must round-trip losslessly.
- Never split image-caption pairs or display math.

## Git workflow

`main` is the only long-lived branch here and CI runs on `main` plus PRs; this repo does not use the `develop` integration branch described in the global user config.
