import type { PresentationBlock } from '../../src/engine/types'

/**
 * Deterministic synthetic measurement for headless corpus runs.
 *
 * Real pagination uses browser-measured heights; this model exists so the
 * harness is reproducible in CI. It approximates rendered geometry from
 * content — height grows with text length, list items, code lines, and table
 * rows — without depending on fonts or a DOM. The absolute numbers do not
 * matter; what matters is that they are stable, plausible, and content-driven,
 * so planner regressions show up as metric deltas rather than flakes.
 *
 * Blocks whose text contains the OVERSIZED marker measure taller than any
 * viewport capacity in the matrix, modeling content that genuinely cannot fit.
 */

const OVERSIZED_HEIGHT = 4000

function inlineTextOf(block: PresentationBlock): string {
  const walk = (nodes: NonNullable<PresentationBlock['inlines']>): string =>
    nodes.map((node) => ('value' in node ? node.value : 'children' in node ? walk(node.children) : '')).join('')
  return block.inlines ? walk(block.inlines) : block.value ?? block.alt ?? ''
}

export function measureBlock(block: PresentationBlock): number {
  const text = inlineTextOf(block)
  if (text.includes('OVERSIZED') || (block.alt ?? '').includes('OVERSIZED') || (block.value ?? '').includes('OVERSIZED')) {
    return OVERSIZED_HEIGHT
  }
  switch (block.type) {
    case 'heading':
      return block.depth === 1 ? 112 : block.depth === 2 ? 76 : 64
    case 'paragraph':
      return 24 + Math.ceil(Math.max(1, text.length) / 70) * 32
    case 'list':
      return 20 + (block.listItems?.length ?? 1) * 38
    case 'figure':
      return 280
    case 'code':
      return 48 + (block.value?.split('\n').length ?? 1) * 24
    case 'code-group':
      return 72 + Math.max(1, ...(block.codeGroup ?? []).map((child) => child.value?.split('\n').length ?? 1)) * 24
    case 'math':
      return 96 + (block.value?.split('\n').length ?? 1) * 28
    case 'table':
      return 40 + (block.tableRows?.length ?? 1) * 44
    case 'blockquote':
      return 60 + Math.ceil(Math.max(1, text.length) / 60) * 34
    case 'columns':
      return 60 + Math.max(1, ...(block.columns ?? []).map((column) => column.length)) * 90
    default:
      return 96
  }
}

export function measurementsFor(blocks: PresentationBlock[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const block of blocks) map.set(block.id, measureBlock(block))
  return map
}
