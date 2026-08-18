import { describe, expect, it } from 'vitest'
import { normalizeMarkdownUrls } from './openevidence'

describe('normalizeMarkdownUrls', () => {
  it('strips whitespace inside a single-line URL', () => {
    expect(normalizeMarkdownUrls('![w:480](https://example.com/my image.png)'))
      .toBe('![w:480](https://example.com/myimage.png)')
  })

  it('leaves URLs without whitespace untouched', () => {
    const markdown = '![bg left:50%](https://example.com/a.png) and [ref](https://other.com/x)'
    expect(normalizeMarkdownUrls(markdown)).toBe(markdown)
  })

  it('never matches across newlines while an image paren is still unclosed', () => {
    // Mid-edit state: the image URL has no closing paren yet, but a later link
    // does. Collapsing everything between them destroys the document.
    const markdown = '前文 ![alt](https://example.com/img\n\n下一段文字 [ref](https://other.com/x)'
    expect(normalizeMarkdownUrls(markdown)).toBe(markdown)
  })
})
