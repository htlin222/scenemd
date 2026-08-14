import { describe, expect, it } from 'vitest'
import {
  formatImageAttributes,
  parseImageAttributes,
  parseMarpitImageAlt,
  quartoImageCaption,
} from './imageSyntax'

describe('parseImageAttributes', () => {
  it('treats the bracket text as verbatim alt when an attribute block exists', () => {
    const options = parseImageAttributes('auto contain hero words', 'width=40%')
    expect(options.alt).toBe('auto contain hero words')
    expect(options.width).toBe('40%')
    expect(options.layout).toBe('legend')
  })

  it('parses the full attribute vocabulary', () => {
    const options = parseImageAttributes('chart', 'width=480px height=280px layout=hero fit=auto bg side=left split=40% vertical filter="brightness:.8 sepia:50%"')
    expect(options).toMatchObject({
      alt: 'chart',
      width: '480px',
      height: '280px',
      layout: 'hero',
      fit: 'auto',
      background: true,
      side: 'left',
      splitSize: '40%',
      vertical: true,
      filters: 'brightness:.8 sepia:50%',
    })
  })

  it('ignores unknown keys and invalid values instead of guessing', () => {
    const options = parseImageAttributes('alt', 'width=banana wat=7 layout=spiral')
    expect(options.width).toBe('')
    expect(options.layout).toBe('legend')
  })

  it('falls back to the Marpit alt tokenizer when there is no attribute block', () => {
    const options = parseImageAttributes('w:480 hero chart title', null)
    expect(options.width).toBe('480')
    expect(options.layout).toBe('hero')
    expect(options.alt).toBe('chart title')
  })
})

describe('size attribute', () => {
  it('parses size as a percentage of the scene height', () => {
    expect(parseImageAttributes('alt', 'size=45%').size).toBe('45%')
  })

  it('rejects a non-percentage size', () => {
    expect(parseImageAttributes('alt', 'size=300px').size).toBe('')
  })

  it('formats size and round-trips it', () => {
    const options = parseImageAttributes('alt', 'size=45%')
    expect(formatImageAttributes(options)).toBe('{size=45%}')
  })

  it('leaves size empty for legacy Marpit alt syntax', () => {
    expect(parseMarpitImageAlt('w:480 chart').size).toBe('')
  })
})

describe('Quarto-style attributes', () => {
  it('reads fig-alt as the alt text', () => {
    const options = parseImageAttributes('圖一：說明', 'width=40% fig-alt="GFR chart"')
    expect(options.alt).toBe('GFR chart')
    expect(options.width).toBe('40%')
  })

  it('clears the alt when a Quarto id marks the bracket as a caption', () => {
    // Quarto semantics: bracket text is the caption, not alt.
    const options = parseImageAttributes('圖一：說明', '#fig-gfr width=40%')
    expect(options.alt).toBe('')
  })

  it('exposes the bracket text as the Quarto caption', () => {
    expect(quartoImageCaption('圖一：說明', '#fig-gfr width=40%')).toBe('圖一：說明')
    expect(quartoImageCaption('圖一：說明', 'fig-alt="chart"')).toBe('圖一：說明')
    expect(quartoImageCaption('plain alt', 'width=40%')).toBeNull()
    expect(quartoImageCaption('legacy', null)).toBeNull()
  })
})

describe('formatImageAttributes', () => {
  // design v5: `size` is the only author-configurable thing — everything else
  // is dictated by the forced figure layout, so the write path emits size
  // alone and legacy options normalize away.
  it('writes only the size', () => {
    const options = parseImageAttributes('chart', 'size=45% width=40% layout=hero filter="brightness:.8"')
    expect(formatImageAttributes(options)).toBe('{size=45%}')
  })

  it('returns an empty string without a size', () => {
    expect(formatImageAttributes(parseImageAttributes('just alt', ''))).toBe('')
    expect(formatImageAttributes(parseImageAttributes('chart', 'width=480px fit=auto'))).toBe('')
  })

  it('round-trips the size and normalizes legacy Marpit options away', () => {
    const legacy = parseMarpitImageAlt('bg left:33% w:480 brightness:.8 the alt')
    expect(legacy.width).toBe('480')
    expect(formatImageAttributes(legacy)).toBe('')

    const sized = parseImageAttributes('the alt', 'size=45%')
    const reparsed = parseImageAttributes(sized.alt, formatImageAttributes(sized).slice(1, -1))
    expect(reparsed).toEqual(sized)
  })
})
