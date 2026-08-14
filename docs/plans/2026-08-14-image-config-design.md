# Image config redesign — hybrid attribute syntax

Date: 2026-08-14 · Status: approved (chat), implementing on `fix/editor-scroll-top`

## Problem

The Marpit alt-token syntax packs alt text, sizing, layout, and filters into one
string. The parser guesses token-by-token, so ordinary words (`auto`, `contain`,
`hero`) silently become config, alt and caption have competing sources, and the
image popover must round-trip through a lossy grammar. This produced a chain of
editor bugs (scroll jumps, popover misfires, wrong-line selection) that were all
symptoms of the same design.

## Decision

Each piece of information gets exactly one home:

```markdown
![GFR decline chart](https://…/fig.png){width=40% layout=hero}
圖一：腎絲球過濾率隨年齡下降
```

- **Bracket text = alt** — accessibility only, standard Markdown semantics.
- **`{key=value …}` = config** — Quarto/Pandoc-style attribute block placed
  immediately after `)`, same paragraph. Deterministic, validatable, extensible.
- **Same-paragraph text = legend** — the rule shipped earlier; visible as a
  plain paragraph on HackMD/GitHub, edited via the popover Legend field.

Alternatives considered: strict Quarto (bracket = caption; rejected because the
caption becomes invisible on HackMD, which this repo syncs to) and a stricter
Marpit tokenizer (rejected: still not extensible to multi-figure layout or
cross-references).

## Attribute schema

| Key | Values | Maps to |
| --- | --- | --- |
| `width` / `height` | CSS length | `width` / `height` |
| `layout` | `legend` (default) \| `hero` \| `auto` | `layout` |
| `fit` | `contain` (default) \| `auto` | `fit` |
| `bg` | flag | `background` |
| `side` | `left` \| `right` | `side` (bg only) |
| `split` | percentage | `splitSize` (bg only) |
| `filter` | quoted token list, e.g. `"brightness:.8 sepia:50%"` | `filters` |
| `vertical` | flag | `vertical` |

Defaults are omitted when formatting; an image with no non-default options
carries no `{…}` at all.

## Compatibility (expand/contract)

- **Read both, forever cheap:** when an image has an attribute block, the
  bracket is verbatim alt and attributes are authoritative. Without one, the
  legacy Marpit alt tokenizer runs unchanged.
- **Write new only:** the popover and any programmatic rewrite emit hybrid
  syntax, so documents migrate edit-by-edit.

## Touch points

1. `src/imageSyntax.ts` — `parseImageAttributes` / `formatImageAttributes`,
   quote-aware tokenizer; legacy parser kept for fallback.
2. `src/engine/semantics.ts` — an attribute block sitting right after the image
   in the paragraph is consumed as config and excluded from the caption.
3. `src/components/MarkdownEditor.tsx` — popover image span includes the
   optional `{…}`; save composes hybrid; relocation extends over trailing
   attributes so stale blocks are never left behind.
4. `MarkdownDocumentView` — a remark pass folds the attribute block into the
   image before rendering so `{…}` never shows as literal text.
5. `src/lib/legendText.ts` — unchanged semantics; the wider image span already
   keeps attributes out of the legend.

## Follow-up (separate change)

Pagination: figures are measured at a fixed 240px frame but render at `31cqw`
in the legend grid, and the planner marks any over-capacity multi-block
candidate invalid — in short viewports this strands every paragraph after a
figure onto the next scene. Fix planned with a Playwright pipeline harness
(markdown → measure → planScenes → SceneView) to reproduce and pin behavior.
