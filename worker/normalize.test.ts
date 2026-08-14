import { describe, expect, it } from 'vitest'
import { normalizeMarkdownWhitespace } from './normalize'

// Rationale in normalize.ts.

describe('normalizeMarkdownWhitespace', () => {
  it('turns whitespace-only lines into empty lines', () => {
    expect(normalizeMarkdownWhitespace('a\n        \nb\n')).toBe('a\n\nb\n')
    expect(normalizeMarkdownWhitespace('a\n  \t \nb\n')).toBe('a\n\nb\n')
  })

  it('collapses runs of blank lines to a single blank line', () => {
    expect(normalizeMarkdownWhitespace('1. a\n  \n        \n        \n2. b\n')).toBe('1. a\n\n2. b\n')
    expect(normalizeMarkdownWhitespace('a\n\n\n\n\nb\n')).toBe('a\n\nb\n')
  })

  it('keeps single blank lines and ordinary content untouched', () => {
    const markdown = '# Title\n\nAlpha.\n\n- one\n- two\n'
    expect(normalizeMarkdownWhitespace(markdown)).toBe(markdown)
  })

  it('preserves trailing spaces on content lines (markdown hard breaks)', () => {
    expect(normalizeMarkdownWhitespace('line one  \nline two\n')).toBe('line one  \nline two\n')
  })

  it('leaves blank runs adjacent to indented code chunks untouched', () => {
    // Inside 4-space indented code blocks, whitespace-only lines and blank-run
    // lengths are literal content — collapsing them would change the code.
    const markdown = 'Para.\n\n    line1\n        \n    line2\n\n\n    line3\n\nAfter.\n'
    expect(normalizeMarkdownWhitespace(markdown)).toBe(markdown)
  })

  it('does not treat inline code spans as fence openings', () => {
    // A backtick fence's info string cannot contain backticks, so this line is
    // a paragraph and must not disable normalization for the rest of the file.
    expect(normalizeMarkdownWhitespace('```inline``` text\n\n\n\nend\n')).toBe('```inline``` text\n\nend\n')
  })

  it('leaves fenced code blocks byte-for-byte intact', () => {
    const markdown = 'before\n\n```txt\ncode\n    \n\n\n\nmore code\n```\n\nafter\n'
    expect(normalizeMarkdownWhitespace(markdown)).toBe(markdown)
  })

  it('normalizes again after a fenced code block closes', () => {
    expect(normalizeMarkdownWhitespace('```\nx\n```\n   \n\n\nend\n')).toBe('```\nx\n```\n\nend\n')
  })

  it('is idempotent', () => {
    const once = normalizeMarkdownWhitespace('a\n   \n\n\n   \nb\n')
    expect(normalizeMarkdownWhitespace(once)).toBe(once)
  })
})
