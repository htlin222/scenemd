import { describe, expect, it } from 'vitest'
import { foldImageAttributes } from './imageAttributesMdast'
import { parseMarpitImageAlt } from '../imageSyntax'

function paragraphWith(alt: string, trailing: string) {
  return {
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [
        { type: 'image', url: 'fig.png', alt },
        { type: 'text', value: trailing },
      ],
    }],
  }
}

describe('foldImageAttributes', () => {
  it('folds the attribute block into a legacy-parsable alt and removes it from the text', () => {
    const tree = paragraphWith('clean alt', '{width=40% layout=hero} caption stays')
    foldImageAttributes(tree)
    const [image, text] = (tree.children[0] as { children: Array<{ alt?: string; value?: string }> }).children
    const options = parseMarpitImageAlt(image.alt ?? '')
    expect(options.width).toBe('40%')
    expect(options.layout).toBe('hero')
    expect(options.alt).toBe('clean alt')
    expect(text.value).toBe('caption stays')
  })

  it('drops the text node entirely when it held only the attribute block', () => {
    const tree = paragraphWith('alt', '{width=40%}')
    foldImageAttributes(tree)
    expect((tree.children[0] as { children: unknown[] }).children).toHaveLength(1)
  })

  it('leaves images without an attribute block untouched', () => {
    const tree = paragraphWith('w:480 legacy alt', ' plain caption')
    foldImageAttributes(tree)
    const [image, text] = (tree.children[0] as { children: Array<{ alt?: string; value?: string }> }).children
    expect(image.alt).toBe('w:480 legacy alt')
    expect(text.value).toBe(' plain caption')
  })
})
