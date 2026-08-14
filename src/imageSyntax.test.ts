import { describe, expect, it } from 'vitest'
import {
  formatImageAttributes,
  parseImageAttributes,
  parseMarpitImageAlt,
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
