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

A pull request that changes what the product does updates `README.md` and `spec.md` in the same change. Documentation that lags behind behavior is how the specification came to list an implemented feature as a non-goal.

## Design principles

- Prefer coherent under-filled scenes over crowded scenes.
- Never split image-caption pairs or display math.
- Keep the deterministic core independent of Workers AI.
- Preserve source ranges and content-derived identities.
- Treat manual presentation directives as escape hatches, not the default workflow.

By contributing, you agree that your contributions will be licensed under the MIT License.
