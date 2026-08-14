import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Automated WCAG contrast checks for every presentation theme × mode (#14).
//
// The palettes are plain hex values in scene-theme.css, so this needs no
// browser: parse each theme block, compute WCAG 2.1 relative luminance, and
// assert the ratios. Body text is held to AA normal (4.5:1); the teal accent
// colors headings, which render well above 18pt in every scene layout, so it
// is held to AA large (3:1). The muted tone carries real secondary copy
// (breadcrumbs, captions) and is therefore also held to 4.5:1. The faint tone
// is decorative by contract and unchecked.

const css = readFileSync(join(__dirname, 'scene-theme.css'), 'utf8')

interface ThemeBlock {
  name: string
  text: string
  muted: string
  teal: string
  background: string
}

function parseBlock(name: string, selector: string): ThemeBlock {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  if (!match) throw new Error(`Theme block not found: ${selector}`)
  const body = match[1]
  const property = (key: string) => {
    const found = body.match(new RegExp(`${key}:\\s*(#[0-9a-fA-F]{3,6})`))
    if (!found) throw new Error(`${selector} is missing ${key}`)
    return found[1]
  }
  return {
    name,
    text: property('--template-text'),
    muted: property('--template-muted'),
    teal: property('--template-teal'),
    background: property('background'),
  }
}

const BLOCKS: ThemeBlock[] = [
  parseBlock('default light', '.scene'),
  parseBlock('default dark', ":root[data-theme='dark'] .scene"),
  parseBlock('editorial light', ".scene[data-presentation-theme='editorial']"),
  parseBlock('editorial dark', ":root[data-theme='dark'] .scene[data-presentation-theme='editorial']"),
  parseBlock('catppuccin light', ".scene[data-presentation-theme='catppuccin']"),
  parseBlock('catppuccin dark', ":root[data-theme='dark'] .scene[data-presentation-theme='catppuccin']"),
]

function luminance(hex: string): number {
  const value = hex.slice(1)
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(full.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

describe.each(BLOCKS)('$name', (block) => {
  it('body text meets AA normal (4.5:1)', () => {
    expect(contrast(block.text, block.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('muted text meets AA normal (4.5:1)', () => {
    expect(contrast(block.muted, block.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('accent headings meet AA large (3:1)', () => {
    expect(contrast(block.teal, block.background)).toBeGreaterThanOrEqual(3)
  })
})
