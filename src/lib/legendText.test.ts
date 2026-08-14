import { describe, expect, it } from 'vitest'
import { imageParagraphReplacement, readImageLegend } from './legendText'

const IMAGE = '![w:480](https://x.test/a.png)'

function spanOf(source: string, needle: string): { from: number; to: number } {
  const from = source.indexOf(needle)
  return { from, to: from + needle.length }
}

describe('readImageLegend', () => {
  it('reads an empty legend from an image alone in its paragraph', () => {
    const source = `before\n\n${IMAGE}\n\nafter`
    const { from, to } = spanOf(source, IMAGE)
    const context = readImageLegend(source, from, to)
    expect(context.legend).toBe('')
    expect(context.editable).toBe(true)
    expect(source.slice(context.paragraphFrom, context.paragraphTo)).toBe(IMAGE)
  })

  it('reads same-line text after the image as the legend', () => {
    const source = `before\n\n${IMAGE} 圖一：腎絲球過濾率隨年齡下降\n\nafter`
    const { from, to } = spanOf(source, IMAGE)
    const context = readImageLegend(source, from, to)
    expect(context.legend).toBe('圖一：腎絲球過濾率隨年齡下降')
    expect(context.editable).toBe(true)
  })

  it('joins a multi-line paragraph continuation into the legend', () => {
    const source = `${IMAGE} first half\nsecond half\n\nafter`
    const { from, to } = spanOf(source, IMAGE)
    const context = readImageLegend(source, from, to)
    expect(context.legend).toBe('first half second half')
    expect(source.slice(context.paragraphFrom, context.paragraphTo)).toBe(`${IMAGE} first half\nsecond half`)
  })

  it('includes text before the image in the legend', () => {
    const source = `Figure one shows ${IMAGE} the decline.`
    const { from, to } = spanOf(source, IMAGE)
    const context = readImageLegend(source, from, to)
    expect(context.legend).toBe('Figure one shows the decline.')
  })

  it('is not editable when the paragraph holds a second image', () => {
    const source = `${IMAGE} and ![other](https://x.test/b.png)`
    const { from, to } = spanOf(source, IMAGE)
    expect(readImageLegend(source, from, to).editable).toBe(false)
  })

  it('is not editable when the image sits inside a list item', () => {
    const source = `- ${IMAGE} listed`
    const { from, to } = spanOf(source, IMAGE)
    expect(readImageLegend(source, from, to).editable).toBe(false)
  })

  it('stops the paragraph at an adjacent heading instead of swallowing it', () => {
    const source = `## Heading\n${IMAGE} caption`
    const { from, to } = spanOf(source, IMAGE)
    const context = readImageLegend(source, from, to)
    expect(source.slice(context.paragraphFrom, context.paragraphTo)).toBe(`${IMAGE} caption`)
    expect(context.legend).toBe('caption')
  })
})

describe('imageParagraphReplacement', () => {
  it('rewrites the paragraph as image followed by the legend', () => {
    const source = `before\n\nold prefix ${IMAGE} old legend\n\nafter`
    const { from, to } = spanOf(source, IMAGE)
    const change = imageParagraphReplacement(source, from, to, IMAGE, '新的 legend 文字')
    const next = source.slice(0, change.from) + change.insert + source.slice(change.to)
    expect(next).toBe(`before\n\n${IMAGE} 新的 legend 文字\n\nafter`)
  })

  it('leaves only the image when the legend is empty', () => {
    const source = `${IMAGE} outgoing caption\n\nafter`
    const { from, to } = spanOf(source, IMAGE)
    const change = imageParagraphReplacement(source, from, to, IMAGE, '   ')
    const next = source.slice(0, change.from) + change.insert + source.slice(change.to)
    expect(next).toBe(`${IMAGE}\n\nafter`)
  })

  it('collapses newlines typed into the legend to keep the paragraph on one line', () => {
    const source = `${IMAGE}`
    const change = imageParagraphReplacement(source, 0, IMAGE.length, IMAGE, 'line one\nline two')
    expect(change.insert).toBe(`${IMAGE} line one line two`)
  })
})
