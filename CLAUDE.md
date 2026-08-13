# SceneMD contributor guide

## Stack

- React 19 + TypeScript 6 + Vite 8
- Unified/Remark for Markdown parsing
- KaTeX for display and inline math
- Static Cloudflare Pages deployment from `dist/`

## Commands

- `npm run dev` — local development
- `npm run typecheck` — TypeScript checks
- `npm run build` — production build
- `./tools/deploy.sh` — build and deploy to Cloudflare Pages

## Architecture

- `src/engine/semantics.ts` owns Markdown → Presentation AST and regions.
- `src/engine/planner.ts` owns measurement-informed pagination, scoring, and layout selection.
- `src/components/SceneView.tsx` owns rendering only; it must not paginate.
- `src/App.tsx` owns editor and presentation runtime state.

## Conventions

- Keep planning deterministic; AI must never be required.
- Preserve source ranges and stable content-derived IDs.
- Prefer semantic breaks over font shrinking.
- Manual `present: break` directives are hard constraints.
