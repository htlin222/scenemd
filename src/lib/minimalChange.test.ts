import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { minimalDocChange } from './minimalChange'

describe('minimalDocChange', () => {
  it('returns null when the documents are identical', () => {
    expect(minimalDocChange('same text', 'same text')).toBeNull()
  })

  it('replaces only the differing middle span', () => {
    const change = minimalDocChange('one two three', 'one 2 three')
    expect(change).toEqual({ from: 4, to: 7, insert: '2' })
  })

  it('handles an insertion at the end', () => {
    expect(minimalDocChange('abc', 'abcdef')).toEqual({ from: 3, to: 3, insert: 'def' })
  })

  it('handles a deletion in the middle', () => {
    expect(minimalDocChange('keep REMOVE keep', 'keep keep')).toEqual({ from: 5, to: 12, insert: '' })
  })

  it('handles repeated context where prefix and suffix overlap', () => {
    // "aaaa" -> "aaa": prefix scan eats all of next, suffix must not underflow
    const change = minimalDocChange('aaaa', 'aaa')
    expect(change).not.toBeNull()
    const { from, to, insert } = change!
    expect('aaaa'.slice(0, from) + insert + 'aaaa'.slice(to)).toBe('aaa')
  })

  it('keeps the cursor in place when applied as a CodeMirror transaction', () => {
    const current = 'line1\nline2\nline3 ![alt](https://x.com/a.png)\nline4'
    const next = current.replace('line4', 'line4!')
    const state = EditorState.create({ doc: current, selection: { anchor: 20 } })
    const change = minimalDocChange(current, next)
    expect(change).not.toBeNull()
    const transaction = state.update({ changes: change! })
    expect(transaction.state.doc.toString()).toBe(next)
    // The full-document replacement this helper exists to avoid mapped this to 0.
    expect(transaction.state.selection.main.anchor).toBe(20)
  })
})
