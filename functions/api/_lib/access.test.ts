import { describe, expect, it } from 'vitest'
import { canAccessDocument } from './access'

describe('canAccessDocument', () => {
  it('allows everything when no identity is present (Access not deployed)', () => {
    expect(canAccessDocument('owner@example.com', null)).toBe(true)
    expect(canAccessDocument(null, null)).toBe(true)
  })

  it('grandfathers documents that predate Access', () => {
    expect(canAccessDocument(null, 'user@example.com')).toBe(true)
    expect(canAccessDocument(undefined, 'user@example.com')).toBe(true)
  })

  it('allows the owner', () => {
    expect(canAccessDocument('user@example.com', 'user@example.com')).toBe(true)
  })

  it('matches emails case-insensitively and ignores whitespace', () => {
    expect(canAccessDocument('User@Example.com', 'user@example.com')).toBe(true)
    expect(canAccessDocument(' user@example.com ', 'user@example.com')).toBe(true)
  })

  it('denies a different authenticated user', () => {
    // The core of #10: user B must not reach user A's document.
    expect(canAccessDocument('a@example.com', 'b@example.com')).toBe(false)
  })

  it('does not let an empty owner string bypass as an identity', () => {
    expect(canAccessDocument('', 'user@example.com')).toBe(true) // empty = unowned, grandfathered
    expect(canAccessDocument('a@example.com', '')).toBe(true) // empty requester = no Access
  })
})
