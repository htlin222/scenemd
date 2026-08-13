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

There is **no test runner in this repo**. CI (`.github/workflows/ci.yml`) is exactly `npm ci && npm run typecheck && npm run build` — that is the whole automated gate, so behavior changes need manual verification.

`tools/browser-check.mjs` is the manual smoke test: it drives an already-running Chrome via CDP on `127.0.0.1:9222` against `SCENEMD_TEST_URL` (default `http://127.0.0.1:5173`), asserts on DOM selectors, and writes screenshots into `artifacts/`. It fails if selectors like `.documents-hero h1`, `.cm-editor`, or `.markdown-mode-tabs` change — update the script alongside such UI renames.

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
- Figures default to `legend` layout and are glued to adjacent paragraphs via `keepWithNext` / `keepWithPrevious` so pagination cannot strand a caption.

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
- Presentation hints are HTML comments applied to the next block and are hard constraints: `present: break | keep | hero | hide | only | step`, plus the column group `present: columns [n]` / `present: column` / `present: end-columns`. Other `<!-- -->` comments become speaker notes.
- Image options live in Marpit-style alt text (`src/imageSyntax.ts`); `parseMarpitImageAlt` / `formatMarpitImageAlt` must round-trip losslessly, since the visual image popover rewrites source through them.
- Never split image-caption pairs or display math.

## Git workflow

`main` is the only long-lived branch here and CI runs on `main` plus PRs; this repo does not use the `develop` integration branch described in the global user config.
