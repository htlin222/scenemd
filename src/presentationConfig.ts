import type { PresentationConfig } from './engine/types'

export function defaultPresentationConfig(title = 'Untitled presentation'): PresentationConfig {
  return {
    theme: 'default',
    title,
    subtitle: '',
    seriesName: 'SceneMD',
    date: new Date().toISOString().slice(0, 10),
    author: '',
    affiliation: '',
    email: '',
    license: 'CC BY-NC',
  }
}

export function normalizePresentationConfig(value: unknown, fallbackTitle: string): PresentationConfig {
  const fallback = defaultPresentationConfig(fallbackTitle)
  if (!value || typeof value !== 'object') return fallback
  const source = value as Record<string, unknown>
  const text = (key: keyof PresentationConfig, fallbackValue: string) => typeof source[key] === 'string' ? source[key].slice(0, 300) : fallbackValue
  const theme = source.theme === 'editorial' || source.theme === 'catppuccin' ? source.theme : 'default'
  return {
    theme,
    title: text('title', fallback.title).trim() || fallback.title,
    subtitle: text('subtitle', fallback.subtitle),
    seriesName: text('seriesName', fallback.seriesName),
    date: text('date', fallback.date),
    author: text('author', fallback.author),
    affiliation: text('affiliation', fallback.affiliation),
    email: text('email', fallback.email),
    license: text('license', fallback.license),
  }
}
