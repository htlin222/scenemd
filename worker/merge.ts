/**
 * Three-way merge for concurrent autosaves.
 *
 * Extracted from index.ts so it can be tested without loading the Durable
 * Object module, which imports `cloudflare:workers` and cannot run outside
 * the Workers runtime.
 */

export interface TextEdit {
  start: number
  end: number
  insert: string
}

/**
 * Reduce a whole-document change to one contiguous span by trimming the
 * common prefix and suffix. A session that edited several separate places
 * collapses into a single span covering all of them, which is why disjoint
 * edits far apart still conflict when their outermost edits interleave.
 */
export function changedSpan(base: string, next: string): TextEdit | null {
  if (base === next) return null
  let start = 0
  const sharedLimit = Math.min(base.length, next.length)
  while (start < sharedLimit && base[start] === next[start]) start += 1
  let baseEnd = base.length
  let nextEnd = next.length
  while (baseEnd > start && nextEnd > start && base[baseEnd - 1] === next[nextEnd - 1]) {
    baseEnd -= 1
    nextEnd -= 1
  }
  return { start, end: baseEnd, insert: next.slice(start, nextEnd) }
}

export function editsOverlap(left: TextEdit, right: TextEdit): boolean {
  if (left.start === left.end && right.start === right.end) return left.start === right.start
  if (left.start === left.end) return left.start > right.start && left.start < right.end
  if (right.start === right.end) return right.start > left.start && right.start < left.end
  return left.start < right.end && right.start < left.end
}

/**
 * Merge the common autosave case: each client changed one contiguous span of
 * the same base document. Ambiguous overlapping edits remain a real conflict
 * and must be resolved by the author.
 */
export function mergeMarkdown(base: string, local: string, cloud: string): string | null {
  if (local === cloud) return cloud
  if (local === base) return cloud
  if (cloud === base) return local
  const localEdit = changedSpan(base, local)
  const cloudEdit = changedSpan(base, cloud)
  if (!localEdit) return cloud
  if (!cloudEdit) return local
  if (editsOverlap(localEdit, cloudEdit)) return null
  const edits = [localEdit, cloudEdit].sort((left, right) => right.start - left.start)
  return edits.reduce((result, edit) => `${result.slice(0, edit.start)}${edit.insert}${result.slice(edit.end)}`, base)
}
