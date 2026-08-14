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
  it('formats only non-default options', () => {
    const options = parseImageAttributes('chart', 'width=40% layout=hero')
    expect(formatImageAttributes(options)).toBe('{width=40% layout=hero}')
  })

  it('returns an empty string when everything is default', () => {
    const options = parseImageAttributes('just alt', '')
    expect(formatImageAttributes(options)).toBe('')
  })

  it('quotes the filter list', () => {
    const options = parseImageAttributes('a', 'filter="brightness:.8 sepia:50%"')
    expect(formatImageAttributes(options)).toBe('{filter="brightness:.8 sepia:50%"}')
  })

  it('round-trips every attribute losslessly', () => {
    const attrs = 'width=480px height=280px layout=hero fit=auto bg side=left split=40% vertical filter="brightness:.8"'
    const options = parseImageAttributes('auto hero alt words', attrs)
    const reparsed = parseImageAttributes(options.alt, formatImageAttributes(options).slice(1, -1))
    expect(reparsed).toEqual(options)
  })

  it('round-trips legacy Marpit options into the new syntax', () => {
    const legacy = parseMarpitImageAlt('bg left:33% w:480 brightness:.8 the alt')
    const formatted = formatImageAttributes(legacy)
    const reparsed = parseImageAttributes(legacy.alt, formatted.slice(1, -1))
    expect(reparsed).toEqual(legacy)
  })
})
