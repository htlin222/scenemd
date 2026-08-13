import { describe, expect, it } from 'vitest'
import { changedSpan, editsOverlap, mergeMarkdown } from './merge'

// Contract (spec.md, "Persistence and security"): a Durable Object serializes
// document edits and rejects stale base revisions. The merge exists so that two
// sessions editing different parts of a document do not force one to lose work,
// while genuinely ambiguous edits stay a conflict for the author to resolve.

const BASE = '# Title\n\nAlpha paragraph.\n\nBravo paragraph.\n'

describe('changedSpan', () => {
  it('reports no change for identical documents', () => {
    expect(changedSpan(BASE, BASE)).toBeNull()
  })

  it('describes a pure insertion as an empty span', () => {
    const edit = changedSpan('AC', 'ABC')
    expect(edit).toEqual({ start: 1, end: 1, insert: 'B' })
  })

  it('describes a pure deletion as an empty insert', () => {
    const edit = changedSpan('ABC', 'AC')
    expect(edit).toEqual({ start: 1, end: 2, insert: '' })
  })

  it('collapses several separate edits into one covering span', () => {
    // This is the documented limitation, not an accident: a session that edited
    // in two places produces a span covering both, so its effective conflict
    // surface is wider than the text it actually touched.
    const edit = changedSpan('A B C', 'X B Z')
    expect(edit).toEqual({ start: 0, end: 5, insert: 'X B Z' })
  })
})

describe('editsOverlap', () => {
  it('treats adjacent but disjoint spans as non-overlapping', () => {
    expect(editsOverlap({ start: 0, end: 3, insert: 'x' }, { start: 3, end: 6, insert: 'y' })).toBe(false)
  })

  it('treats intersecting spans as overlapping', () => {
    expect(editsOverlap({ start: 0, end: 4, insert: 'x' }, { start: 3, end: 6, insert: 'y' })).toBe(true)
  })

  it('treats two insertions at the same point as overlapping', () => {
    // Both want to insert at the same offset, so their order is ambiguous.
    expect(editsOverlap({ start: 3, end: 3, insert: 'x' }, { start: 3, end: 3, insert: 'y' })).toBe(true)
  })

  it('treats insertions at different points as non-overlapping', () => {
    expect(editsOverlap({ start: 1, end: 1, insert: 'x' }, { start: 4, end: 4, insert: 'y' })).toBe(false)
  })

  it('treats an insertion strictly inside a replaced span as overlapping', () => {
    expect(editsOverlap({ start: 0, end: 6, insert: 'x' }, { start: 3, end: 3, insert: 'y' })).toBe(true)
  })
})

describe('mergeMarkdown', () => {
  it('returns the shared text when both sides are identical', () => {
    expect(mergeMarkdown(BASE, BASE, BASE)).toBe(BASE)
  })

  it('takes the other side when one session did not change anything', () => {
    const cloud = BASE.replace('Bravo', 'Charlie')
    expect(mergeMarkdown(BASE, BASE, cloud)).toBe(cloud)

    const local = BASE.replace('Alpha', 'Delta')
    expect(mergeMarkdown(BASE, local, BASE)).toBe(local)
  })

  it('takes either when both sessions made the same change', () => {
    const same = BASE.replace('Alpha', 'Echo')
    expect(mergeMarkdown(BASE, same, same)).toBe(same)
  })

  it('merges edits to different paragraphs without losing either', () => {
    const local = BASE.replace('Alpha paragraph.', 'Alpha paragraph, revised.')
    const cloud = BASE.replace('Bravo paragraph.', 'Bravo paragraph, revised.')

    const merged = mergeMarkdown(BASE, local, cloud)

    // Neither author's work may be dropped.
    expect(merged).toContain('Alpha paragraph, revised.')
    expect(merged).toContain('Bravo paragraph, revised.')
    expect(merged).toBe('# Title\n\nAlpha paragraph, revised.\n\nBravo paragraph, revised.\n')
  })

  it('merges an insertion at the start with an insertion at the end', () => {
    expect(mergeMarkdown('AC', 'ABC', 'ACD')).toBe('ABCD')
  })

  it('refuses to merge when both sessions changed the same text', () => {
    // Two different rewrites of the same sentence have no defensible
    // resolution, so this must stay a conflict rather than silently pick one.
    const local = BASE.replace('Alpha paragraph.', 'Alpha paragraph, my version.')
    const cloud = BASE.replace('Alpha paragraph.', 'Alpha paragraph, their version.')

    expect(mergeMarkdown(BASE, local, cloud)).toBeNull()
  })

  it('refuses to merge when one edit is contained inside the other', () => {
    const local = BASE.replace('Alpha paragraph.\n\nBravo paragraph.', 'Replaced both paragraphs.')
    const cloud = BASE.replace('Bravo', 'Bravissimo')

    expect(mergeMarkdown(BASE, local, cloud)).toBeNull()
  })

  it('handles an empty base document', () => {
    expect(mergeMarkdown('', 'local text', '')).toBe('local text')
    expect(mergeMarkdown('', '', 'cloud text')).toBe('cloud text')
  })

  it('never returns a document missing content both sides kept', () => {
    const local = `${BASE}\nAppended locally.\n`
    const cloud = BASE.replace('# Title', '# Retitled')

    const merged = mergeMarkdown(BASE, local, cloud)

    expect(merged).not.toBeNull()
    expect(merged).toContain('Appended locally.')
    expect(merged).toContain('# Retitled')
    expect(merged).toContain('Alpha paragraph.')
  })
})
