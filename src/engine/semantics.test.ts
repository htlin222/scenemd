import { describe, expect, it } from 'vitest'
import { buildSemanticRegions, parsePresentationDocument } from './semantics'
import type { PresentationBlock } from './types'

// Expected values here are derived from the contracts in spec.md — "Semantic
// normalization", "Presentation AST", and "Manual overrides" — not from
// observing current output.

const typesOf = (blocks: PresentationBlock[]) => blocks.map((block) => block.type)
const find = (blocks: PresentationBlock[], type: PresentationBlock['type']) =>
  blocks.find((block) => block.type === type)

describe('parsePresentationDocument — semantic normalization', () => {
  it('marks headings as keeping with the next block', () => {
    // spec: "Headings strongly keep with the next block."
    const blocks = parsePresentationDocument('## Diagnosis\n\nSome prose.\n')
    const heading = find(blocks, 'heading')

    expect(heading?.keepWithNext).toBe(true)
    expect(heading?.depth).toBe(2)
    expect(heading?.semanticRole).toBe('section-title')
  })

  it('gives H1 the title role and maximum importance', () => {
    const blocks = parsePresentationDocument('# Acute Myeloid Leukemia\n')
    const heading = find(blocks, 'heading')

    expect(heading?.semanticRole).toBe('title')
    expect(heading?.importance).toBe(1)
  })

  it('normalizes an image and its caption into one atomic figure', () => {
    // spec: "Image and caption normalize into one atomic figure."
    const blocks = parsePresentationDocument('![w:520px Bone marrow](marrow.jpg)\n')
    const figure = find(blocks, 'figure')

    expect(figure).toBeDefined()
    expect(figure?.url).toBe('marrow.jpg')
    expect(figure?.alt).toBe('Bone marrow')
    expect(figure?.keepTogether).toBe(true)
    expect(figure?.semanticRole).toBe('figure')
    // The Marpit sizing directive is parsed out of the alt text, not left in it.
    expect(figure?.imageOptions?.width).toBe('520px')
  })

  it('glues a figure to the prose around it so pagination cannot strand a legend', () => {
    const blocks = parsePresentationDocument(
      'Lead-in prose.\n\n![Figure](f.png)\n\nExplanatory copy.\n',
    )
    const figureIndex = blocks.findIndex((block) => block.type === 'figure')

    expect(blocks[figureIndex - 1].keepWithNext).toBe(true)
    expect(blocks[figureIndex].keepWithPrevious).toBe(true)
    expect(blocks[figureIndex].keepWithNext).toBe(true)
    expect(blocks[figureIndex + 1].keepWithPrevious).toBe(true)
  })

  it('keeps a quote atomic and treats it as a statement', () => {
    // spec: "Quote and attribution remain together."
    const blocks = parsePresentationDocument('> Treatment depends on fitness.\n')
    const quote = find(blocks, 'blockquote')

    expect(quote?.keepTogether).toBe(true)
    expect(quote?.layoutHint).toBe('statement')
    expect(quote?.semanticRole).toBe('key-message')
  })

  it('keeps display math atomic', () => {
    // spec: "Display math never splits."
    const blocks = parsePresentationDocument('$$\nE = mc^2\n$$\n')
    const math = find(blocks, 'math')

    expect(math?.keepTogether).toBe(true)
  })

  it('keeps a small table atomic', () => {
    // spec: "Small tables remain atomic."
    const markdown = '| A | B |\n| - | - |\n| 1 | 2 |\n'
    const blocks = parsePresentationDocument(markdown)
    const tables = blocks.filter((block) => block.type === 'table')

    expect(tables).toHaveLength(1)
    expect(tables[0].semanticRole).toBe('evidence')
  })

  it('repeats the header on every chunk of a large table', () => {
    // spec: "Large tables repeat headers and paginate by logical row groups."
    const rows = ['| Drug | Dose |', '| - | - |', ...Array.from({ length: 6 }, (_, i) => `| D${i} | ${i}mg |`)]
    const blocks = parsePresentationDocument(`${rows.join('\n')}\n`)
    const tables = blocks.filter((block) => block.type === 'table')

    expect(tables.length).toBeGreaterThan(1)
    const header = tables[0].tableRows?.[0]
    expect(header).toEqual(['Drug', 'Dose'])
    for (const table of tables) {
      expect(table.tableRows?.[0]).toEqual(header)
    }
    // Every chunk after the first is marked as a continuation so it does not
    // read as new content.
    expect(tables.slice(1).every((table) => table.continuation)).toBe(true)
  })

  it('preserves inline structure inside list items', () => {
    const blocks = parsePresentationDocument('- Plain item\n- Item with **bold**\n')
    const list = find(blocks, 'list')

    expect(list?.listItems).toHaveLength(2)
    expect(list?.ordered).toBe(false)
    expect(list?.listItems?.[1].some((node) => node.type === 'strong')).toBe(true)
  })

  it('retains a source range on every block', () => {
    // spec: "Every block retains a stable source range."
    const blocks = parsePresentationDocument('# Title\n\nProse.\n\n- item\n')

    for (const block of blocks) {
      expect(block.sourceRange.startLine).toBeGreaterThan(0)
      expect(block.sourceRange.endLine).toBeGreaterThanOrEqual(block.sourceRange.startLine)
    }
  })

  it('derives block identity from content, not position', () => {
    // spec: "Scene identity derives from region and boundary block identities,
    // not array position alone."
    const first = parsePresentationDocument('## Section\n\nIdentical prose.\n')
    const second = parsePresentationDocument('## Section\n\nIdentical prose.\n')

    expect(typesOf(first)).toEqual(typesOf(second))
    expect(first.map((block) => block.id)).toEqual(second.map((block) => block.id))
  })
})

describe('parsePresentationDocument — manual overrides', () => {
  it('turns present: break into a hard break before the next block', () => {
    // spec: "A manual break has infinite priority and cannot be overridden."
    const blocks = parsePresentationDocument('Before.\n\n<!-- present: break -->\n\nAfter.\n')
    const after = blocks.at(-1)

    expect(after?.breakBefore).toBe('always')
  })

  it('applies a directive only to the block that follows it', () => {
    const blocks = parsePresentationDocument('<!-- present: keep -->\n\nFirst paragraph.\n\nSecond paragraph.\n')

    expect(blocks).toHaveLength(2)
    expect(blocks[0].keepWithNext).toBe(true)
    expect(blocks[1].keepWithNext).toBe(false)
  })

  it('applies present: hero to a figure', () => {
    // Regression test for #23: the figure post-pass used to overwrite the
    // layoutHint set by applyDirectives, making the directive a no-op on the
    // only block type it is meaningful for.
    const blocks = parsePresentationDocument('<!-- present: hero -->\n\n![One](a.png)\n')
    const figure = blocks.find((block) => block.type === 'figure')

    expect(figure?.layoutHint).toBe('hero')
  })

  it('still honours the Marpit alt form of hero', () => {
    const blocks = parsePresentationDocument('![hero One](a.png)\n')
    const figure = blocks.find((block) => block.type === 'figure')

    expect(figure?.layoutHint).toBe('hero')
  })

  it('keeps a block with the next one under present: keep', () => {
    const blocks = parsePresentationDocument('<!-- present: keep -->\n\nStays together.\n\nNext.\n')

    expect(blocks[0].keepTogether).toBe(true)
    expect(blocks[0].keepWithNext).toBe(true)
  })

  it('drops hidden blocks from the presentation entirely', () => {
    const blocks = parsePresentationDocument('Visible.\n\n<!-- present: hide -->\n\nHidden.\n')

    expect(blocks).toHaveLength(1)
    expect(blocks[0].visibility).toBe('normal')
  })

  it('marks present: only blocks as presentation-only', () => {
    const blocks = parsePresentationDocument('<!-- present: only -->\n\nSpeaker aside.\n')

    expect(blocks[0].visibility).toBe('presentation-only')
  })

  it('marks a list for progressive reveal under present: step', () => {
    const blocks = parsePresentationDocument('<!-- present: step -->\n\n- one\n- two\n')

    expect(find(blocks, 'list')?.stepped).toBe(true)
  })

  it('groups bracketed content into a columns block', () => {
    const blocks = parsePresentationDocument(
      '<!-- present: columns 2 -->\n\nLeft side.\n\n<!-- present: column -->\n\nRight side.\n\n<!-- present: end-columns -->\n',
    )
    const columns = find(blocks, 'columns')

    expect(columns).toBeDefined()
    expect(columns?.columns).toHaveLength(2)
    expect(columns?.keepTogether).toBe(true)
  })

  it('attaches any other HTML comment as a speaker note', () => {
    const blocks = parsePresentationDocument('<!-- Mention the trial here -->\n\nProse.\n')

    expect(blocks[0].speakerNotes).toEqual(['Mention the trial here'])
    expect(blocks[0].speakerNoteRanges).toHaveLength(1)
  })

  it('does not treat a directive comment as a speaker note', () => {
    const blocks = parsePresentationDocument('<!-- present: keep -->\n\nProse.\n')

    expect(blocks[0].speakerNotes).toBeUndefined()
  })
})

describe('buildSemanticRegions', () => {
  it('gives an H1 its own region so it becomes a chapter divider', () => {
    const blocks = parsePresentationDocument('# Chapter\n\nBody prose.\n')
    const regions = buildSemanticRegions(blocks)

    expect(regions).toHaveLength(2)
    expect(regions[0].blocks).toHaveLength(1)
    expect(regions[0].blocks[0].depth).toBe(1)
  })

  it('starts a new region at each H2 and H3', () => {
    const blocks = parsePresentationDocument('## One\n\nA.\n\n## Two\n\nB.\n\n### Three\n\nC.\n')
    const regions = buildSemanticRegions(blocks)

    expect(regions).toHaveLength(3)
  })

  it('accumulates the heading path for breadcrumbs', () => {
    // spec: "H3 scenes show their parent H2 as a breadcrumb."
    const blocks = parsePresentationDocument('# Book\n\n## Chapter\n\n### Section\n\nProse.\n')
    const regions = buildSemanticRegions(blocks)
    const deepest = regions.at(-1)

    expect(deepest?.headingPath).toEqual(['Book', 'Chapter', 'Section'])
  })

  it('resets the heading path when a new H1 starts', () => {
    const blocks = parsePresentationDocument('# One\n\n## Under one\n\n# Two\n\n## Under two\n')
    const regions = buildSemanticRegions(blocks)
    const last = regions.at(-1)

    expect(last?.headingPath[0]).toBe('Two')
    expect(last?.headingPath).not.toContain('One')
  })

  it('records a manual break as an explicit region boundary', () => {
    const blocks = parsePresentationDocument('Before.\n\n<!-- present: break -->\n\nAfter.\n')
    const regions = buildSemanticRegions(blocks)

    expect(regions).toHaveLength(2)
    expect(regions[1].explicitBreakBefore).toBe(true)
  })

  it('does not split a region on a heading deeper than H3', () => {
    const blocks = parsePresentationDocument('## Section\n\nA.\n\n#### Minor\n\nB.\n')
    const regions = buildSemanticRegions(blocks)

    expect(regions).toHaveLength(1)
  })

  it('keeps every block in exactly one region', () => {
    const blocks = parsePresentationDocument('# A\n\nOne.\n\n## B\n\nTwo.\n\n### C\n\nThree.\n')
    const regions = buildSemanticRegions(blocks)
    const regionBlockIds = regions.flatMap((region) => region.blocks.map((block) => block.id))

    expect(regionBlockIds).toEqual(blocks.map((block) => block.id))
  })
})
