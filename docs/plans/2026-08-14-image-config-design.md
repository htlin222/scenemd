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

## v2 — figure module UX (approved 2026-08-14, second interview)

Core principle: **the author decides only how much of the 16:9 scene the image
occupies; everything else stays semantic.**

1. **`size=NN%`** — the figure's height as a percentage of the scene height,
   chosen by dragging on a 16:9 canvas. Because every image has a different
   aspect ratio, the author picks occupied space, not pixel geometry. The
   planner computes figure height arithmetically (`size × viewport height`),
   so figures no longer depend on DOM measurement at all — the measured-240px
   vs rendered-31cqw mismatch class of pagination bugs disappears.
2. **Space policy: text yields** (unchanged). The figure keeps its size;
   paragraphs that do not fit flow to the next scene; the legend always stays
   with its figure. With computed heights this is now deterministic.
3. **Auto numbering**: every figure gets "Fig. N" by order of appearance,
   prefixed to the legend caption. No in-text cross-references.
4. **Full-screen figure dialog replaces the popover**: a 16:9 canvas rendering
   the real scene, a size drag handle, the legend edited inline on the canvas,
   drag-and-drop upload/replace, and fit/filter/bg/side/split folded into an
   Advanced section. Entry: clicking the image preview widget or syntax in the
   editor. The small popover retires.
5. **Syntax**: the hybrid attribute block stays; `size` becomes the primary
   dimension. `width`/`height` and legacy Marpit tokens remain readable; every
   dialog save migrates to the new form.

### Implementation stages

1. `size` attribute + planner computes figure heights + renderer honors size
   (`31cqw` default preserved when absent) + Playwright pipeline harness
   (markdown → measure → planScenes → SceneView) pinning that a paragraph
   below a sized figure shares its scene.
2. Fig. N auto numbering.
3. Full-screen dialog; popover removal; e2e migration.

## v3 — the figure is the scene's first-class citizen (2026-08-14)

Author's principle: on every slide the image is the largest first-class
citizen; text arranges itself around it, and some text is *designated* as
must-share-the-scene.

- **Explicit same-scene groups** replace the previous+next-3 auto-glue
  heuristic: `<!-- present: group -->` … `<!-- present: end-group -->` wraps
  the figure and its designated text (mirrors the `present: columns` marker
  family). Enclosed blocks share a `groupId`.
- **The planner never places a scene boundary inside a group.** When a group
  alone exceeds capacity, the scene keeps everything, gets `fillRatio > 1`,
  and carries a warning — the figure is never shrunk and the bound text is
  never evicted; that state is an authoring error surfaced to the author.
- Ungrouped text flows freely across scenes (text yields, as before).

## v5 — one figure layout, position decides text roles (2026-08-14)

The author found figure-neighbor interactions unpredictable and forced the
question: figure pages now have exactly ONE structure. The legend layout,
text-media, media-dominant, and hero/bg layouts are all retired.

The canonical figure page (`---` or a heading cuts pages):

```markdown
段落（前頁）

---
段落 ← 內文，右欄（塞不下就縮字，下限 0.6，再不行才 overflow 警告）

![alt](url){size=45%} ← 圖，左欄；點圖唯一用途＝拖大小

段落 ← legend，渲染在圖下方（自動與圖同場景）
```

- **Structure**: optional heading on top; below it two columns — figure left
  (caption under it, Fig. N badge), body text right.
- **Position decides roles**: prose above the figure = body (right column);
  every consecutive paragraph below the figure = legend (under the image,
  kept with it). Same-paragraph and Quarto captions render there too.
- **size basis**: `size=NN%` is a fraction of the figure column — the height
  remaining under the heading. The frame resolves it as a CSS percentage and
  may yield at most 25% to its captions; the planner mirrors both rules, so
  plan and pixels cannot drift.
- **Above text shrinks to fit** ("縮小文字，總之塞就對了"): the planner
  computes `figureTextScale = available/height` (floor 0.6) per scene and the
  text column applies it; below the floor the scene overflows with a warning.
- **Dialog**: the figure dialog edits only the figure (size drag, URL, alt,
  replace, advanced fit/filter). Captions are edited as ordinary markdown;
  same-paragraph captions round-trip untouched through a dialog save.
- **hero/bg retirement**: every hero spelling (Marpit token, `layout=hero`,
  `present: hero` — fixing the dead-directive bug #23) maps to `size=100%`;
  `bg`/`side`/`split` still parse and format losslessly but no longer alter
  rendering.

## v4 — HackMD reveal.js downward compatibility (2026-08-14)

The syntax must degrade gracefully in both directions with HackMD's
reveal.js slide mode. The contract, each clause verified by a parser test:

| HackMD / reveal input | SceneMD behavior |
| --- | --- |
| YAML frontmatter (`type: slide`, `slideOptions`) | Masked with blank lines before parsing — never content, and source line numbers below stay accurate for editor↔scene sync. |
| `---` / `----` slide separators | Already aligned: thematic breaks are scene breaks. |
| `<!-- .slide: … -->` / `<!-- .element: … -->` | Ignored (they are directives for another engine) — previously they were swallowed as speaker notes. |
| `Note:` paragraph | Becomes a speaker note **only when the frontmatter declares `type: slide`** — ordinary prose legitimately starts with "Note:", so the gate keeps the conversion deterministic. |
| `![alt](url =300x200)` imsize | Fails CommonMark image parsing (arrives as literal text); recovered as a figure with pixel width/height and same-paragraph caption. |
| SceneMD → HackMD | `present:` comments and `{…}` blocks are invisible or inert in reveal mode; the legend renders as a plain paragraph. |

Known non-goals for now: mapping `.slide: data-background` onto SceneMD
background figures, and emitting imsize on save (SceneMD always writes the
hybrid attribute block).

### Quarto downward compatibility

The hybrid attribute block descends from Quarto's, but the two disagree on
what the bracket means (Quarto: caption; SceneMD: alt). A `#fig-…` id or
`fig-alt=` attribute is the deterministic fingerprint of Quarto authorship
and flips the interpretation:

| Quarto input | SceneMD behavior |
| --- | --- |
| `![Caption](url){#fig-x width=40% fig-alt="…"}` | Bracket → legend caption, `fig-alt` → alt, `width`/`height` shared vocabulary. Without `fig-alt`, alt stays empty rather than duplicating the caption. |
| Fenced divs `::: {layout-ncol=2}` … `:::` | Fence marker paragraphs are dropped; their content flows normally (callouts degrade to plain prose). |
| YAML frontmatter | Same masking as the HackMD clause. |
| `@fig-x` cross-references, `{{< shortcodes >}}` | Render literally; accepted limitation. |
| Dialog save | Migrates to hybrid form; the Quarto caption pre-fills the Legend field so it lands in the same-paragraph legend instead of being lost. |

### Marp downward compatibility

Marp is the easiest of the three — the image syntax descends from Marpit
and the legacy read path already covers it:

| Marp input | SceneMD behavior |
| --- | --- |
| `![w:480](…)`, `![bg left:33%](…)` alt tokens | Already read via the legacy Marpit parser (the hybrid migration path). |
| `---` separators, frontmatter (`marp: true`, `theme:` …) | Same handling as the HackMD clauses above. |
| Comment directives incl. `_class:`-style spot directives, `transition:`, `headingDivider:` | Recognized against the full Marp directive list and ignored — previously the underscored and newer names leaked into speaker notes. |
| Plain HTML comments | Speaker notes — Marp and SceneMD agree on this convention natively. |
| Multiple `![bg]` images in one paragraph | Not supported (multi-image paragraphs are plain paragraphs); accepted limitation. |
| SceneMD → Marp | `{…}` blocks are literal text on slides; `present:` comments land in Marp's presenter notes (Marp's own convention for unknown comments). |

### Superseded v1 follow-up

The earlier pagination note is folded into stage 1: with `size`, the planner
stops trusting figure measurements, which was the root of the strand-the-
paragraph behavior in short viewports.
