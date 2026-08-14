export interface MinimalChange {
  from: number
  to: number
  insert: string
}

export function minimalDocChange(current: string, next: string): MinimalChange | null {
  if (current === next) return null
  const minLength = Math.min(current.length, next.length)
  let start = 0
  while (start < minLength && current.charCodeAt(start) === next.charCodeAt(start)) start += 1
  let currentEnd = current.length
  let nextEnd = next.length
  while (currentEnd > start && nextEnd > start && current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)) {
    currentEnd -= 1
    nextEnd -= 1
  }
  return { from: start, to: currentEnd, insert: next.slice(start, nextEnd) }
}
