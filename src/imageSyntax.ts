export type ImageFit = 'cover' | 'contain' | 'auto'
export type ImageSide = 'none' | 'left' | 'right'
export type ImageLayout = 'auto' | 'legend' | 'hero'

export interface MarpitImageOptions {
  alt: string
  background: boolean
  fit: ImageFit
  layout: ImageLayout
  side: ImageSide
  splitSize: string
  size: string
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
    fit: 'contain',
    layout: 'legend',
    side: 'none',
    splitSize: '50%',
    size: '',
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
    else if (lower === 'legend' || lower === 'lenged' || lower === 'layout:legend') options.layout = 'legend'
    else if (lower === 'hero' || lower === 'layout:hero') options.layout = 'hero'
    else if (lower === 'layout:auto') options.layout = 'auto'
    // Keep accepting Marpit's `cover` token for source compatibility, but
    // SceneMD never crops document images. All image scaling is proportional.
    else if (lower === 'cover') options.fit = 'contain'
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
  if (options.layout !== 'legend') tokens.push(`layout:${options.layout}`)
  if (options.background) tokens.push('bg')
  if (options.background && options.side !== 'none') tokens.push(`${options.side}:${options.splitSize || '50%'}`)
  if (options.background) tokens.push('contain')
  else if (!options.background && options.fit === 'auto') tokens.push('auto')
  if (options.vertical) tokens.push('vertical')
  if (options.width) tokens.push(`w:${options.width}`)
  if (options.height) tokens.push(`h:${options.height}`)
  if (options.filters.trim()) tokens.push(...options.filters.trim().split(/\s+/))
  if (options.alt.trim()) tokens.push(options.alt.trim())
  return tokens.join(' ')
}

function defaultOptions(alt: string): MarpitImageOptions {
  return {
    alt,
    background: false,
    fit: 'contain',
    layout: 'legend',
    side: 'none',
    splitSize: '50%',
    size: '',
    width: '',
    height: '',
    filters: '',
    vertical: false,
  }
}

function attributeTokens(source: string): string[] {
  return source.match(/[^\s"]*"[^"]*"|[^\s"]+/g) ?? []
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value
}

// A `#fig-…` id or `fig-alt=` attribute is the deterministic fingerprint of
// Quarto authorship, where the bracket text is the caption rather than alt.
const QUARTO_MARKER = /(^|\s)(?:#fig-[\w-]+|fig-alt=)/

export function quartoImageCaption(alt: string, attributes: string | null): string | null {
  if (attributes === null || !QUARTO_MARKER.test(attributes)) return null
  const caption = alt.trim()
  return caption || null
}

/**
 * Hybrid syntax: `![alt](url){key=value …}`. With an attribute block present
 * (attributes !== null) the bracket text is verbatim alt and only the block
 * configures the image; without one the legacy Marpit alt tokenizer applies.
 * Unknown keys and invalid values are dropped, never guessed into alt.
 * Quarto-marked blocks (`#fig-…` / `fig-alt=`) flip the bracket to caption
 * semantics: alt comes from fig-alt, or stays empty.
 */
export function parseImageAttributes(alt: string, attributes: string | null): MarpitImageOptions {
  if (attributes === null) return parseMarpitImageAlt(alt)
  const options = defaultOptions(alt)
  let sawFigAlt = false
  for (const token of attributeTokens(attributes.trim())) {
    const separator = token.indexOf('=')
    if (separator < 0) {
      const flag = token.toLowerCase()
      if (flag === 'bg') options.background = true
      else if (flag === 'vertical') options.vertical = true
      continue
    }
    const key = token.slice(0, separator).toLowerCase()
    const value = unquote(token.slice(separator + 1))
    if (key === 'fig-alt') {
      options.alt = value
      sawFigAlt = true
    }
    else if (key === 'width' && LENGTH_PATTERN.test(value)) options.width = value
    else if (key === 'height' && LENGTH_PATTERN.test(value)) options.height = value
    else if (key === 'layout' && ['legend', 'hero', 'auto'].includes(value)) options.layout = value as ImageLayout
    else if (key === 'fit' && ['contain', 'auto'].includes(value)) options.fit = value as ImageFit
    else if (key === 'side' && ['left', 'right'].includes(value)) options.side = value as ImageSide
    else if (key === 'split' && /^\d+(?:\.\d+)?%$/.test(value)) options.splitSize = value
    else if (key === 'size' && /^\d+(?:\.\d+)?%$/.test(value)) options.size = value
    else if (key === 'filter') options.filters = value.trim()
  }
  if (!sawFigAlt && QUARTO_MARKER.test(attributes)) options.alt = ''
  return options
}

// The write vocabulary is deliberately minimal (design v5): the only thing an
// author configures is how much of the scene the figure occupies. Everything
// else (width/height/fit/layout/bg/filter, Marpit alt tokens) stays readable
// for compatibility but normalizes away on save.
export function formatImageAttributes(options: MarpitImageOptions): string {
  return options.size ? `{size=${options.size}}` : ''
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
