export type ImageFit = 'cover' | 'contain' | 'auto'
export type ImageSide = 'none' | 'left' | 'right'

export interface MarpitImageOptions {
  alt: string
  background: boolean
  fit: ImageFit
  side: ImageSide
  splitSize: string
  width: string
  height: string
  filters: string
  vertical: boolean
}

const FILTER_PATTERN = /^(?:blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|opacity|saturate|sepia)(?::\S+)?$/i
const LENGTH_PATTERN = /^(?:auto|\d*\.?\d+(?:px|cm|mm|in|pt|pc|em|rem|%)?)$/i

export function parseMarpitImageAlt(source: string): MarpitImageOptions {
  const options: MarpitImageOptions = {
    alt: '',
    background: false,
    fit: 'cover',
    side: 'none',
    splitSize: '50%',
    width: '',
    height: '',
    filters: '',
    vertical: false,
  }
  const alt: string[] = []
  const filters: string[] = []

  for (const token of source.trim().split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase()
    if (lower === 'bg') options.background = true
    else if (lower === 'cover') options.fit = 'cover'
    else if (lower === 'contain' || lower === 'fit') options.fit = 'contain'
    else if (lower === 'auto') options.fit = 'auto'
    else if (lower === 'vertical') options.vertical = true
    else if (/^(?:left|right)(?::\d+(?:\.\d+)?%)?$/.test(lower)) {
      const [side, size] = lower.split(':')
      options.side = side as ImageSide
      if (size) options.splitSize = size
    } else if (/^(?:w|width):/i.test(token)) {
      const value = token.slice(token.indexOf(':') + 1)
      if (LENGTH_PATTERN.test(value)) options.width = value
      else alt.push(token)
    } else if (/^(?:h|height):/i.test(token)) {
      const value = token.slice(token.indexOf(':') + 1)
      if (LENGTH_PATTERN.test(value)) options.height = value
      else alt.push(token)
    } else if (FILTER_PATTERN.test(token)) filters.push(token)
    else if (options.background && /^\d+(?:\.\d+)?%$/.test(token)) options.fit = token as ImageFit
    else alt.push(token)
  }

  options.alt = alt.join(' ')
  options.filters = filters.join(' ')
  return options
}

export function formatMarpitImageAlt(options: MarpitImageOptions): string {
  const tokens: string[] = []
  if (options.background) tokens.push('bg')
  if (options.background && options.side !== 'none') tokens.push(`${options.side}:${options.splitSize || '50%'}`)
  if (options.background && options.fit !== 'cover') tokens.push(options.fit)
  else if (!options.background && options.fit === 'auto') tokens.push('auto')
  if (options.vertical) tokens.push('vertical')
  if (options.width) tokens.push(`w:${options.width}`)
  if (options.height) tokens.push(`h:${options.height}`)
  if (options.filters.trim()) tokens.push(...options.filters.trim().split(/\s+/))
  if (options.alt.trim()) tokens.push(options.alt.trim())
  return tokens.join(' ')
}

export function imageFilterCss(filters: string): string | undefined {
  const result = filters.split(/\s+/).filter(Boolean).map((token) => {
    const separator = token.indexOf(':')
    if (separator < 0) return `${token}()`
    const name = token.slice(0, separator)
    return `${name}(${token.slice(separator + 1).replaceAll(',', ' ')})`
  })
  return result.length ? result.join(' ') : undefined
}
