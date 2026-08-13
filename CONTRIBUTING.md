# Contributing to SceneMD

SceneMD’s differentiator is the deterministic document-to-scene planner. Contributions should preserve the document-first boundary: Markdown remains canonical, the planner owns pagination, and the renderer only renders `Scene[]`.

## Development

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
npm run build
```

Keep pull requests focused. For planner changes, explain which semantic constraint or score changes and test the effect across wide and narrow viewports.

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

By contributing, you agree that your contributions will be licensed under the MIT License.
