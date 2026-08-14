import { describe, expect, it } from 'vitest'
import { renameMarkdownTitle } from './rename'

describe('renameMarkdownTitle', () => {
  it('rewrites a leading H1 to the new title', () => {
    expect(renameMarkdownTitle('# Old title\n\nBody.\n', 'New title')).toBe('# New title\n\nBody.\n')
  })

  it('skips leading blank lines before the H1', () => {
    expect(renameMarkdownTitle('\n\n# Old\n\nBody.\n', 'New')).toBe('\n\n# New\n\nBody.\n')
  })

  it('leaves the body untouched when the document has no leading H1', () => {
    // A document starting with prose keeps its content; only the stored
    // title changes, and autosave will not fight it because
    // titleFromMarkdown falls back to the stored title without an H1.
    const source = 'Just prose first.\n\n# Later heading\n'
    expect(renameMarkdownTitle(source, 'New')).toBe(source)
  })

  it('does not rewrite an H2 first line', () => {
    const source = '## Section\n\nBody.\n'
    expect(renameMarkdownTitle(source, 'New')).toBe(source)
  })

  it('only rewrites the first H1, never later ones', () => {
    expect(renameMarkdownTitle('# One\n\n# Two\n', 'New')).toBe('# New\n\n# Two\n')
  })

  it('handles an empty document', () => {
    expect(renameMarkdownTitle('', 'New')).toBe('')
  })

  it('preserves titles that contain markdown-ish characters', () => {
    expect(renameMarkdownTitle('# Old\n', 'C# and #tags')).toBe('# C# and #tags\n')
  })
})
