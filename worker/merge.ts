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
 * A pure insertion or deletion whose text repeats the neighbouring content can
 * anchor at several equivalent positions — inserting a line into a run of
 * identical lines is the canonical case. changedSpan picks one anchor
 * arbitrarily, so two racing saves of the same edit can end up with disjoint
 * spans and both get applied, silently duplicating (or double-deleting) the
 * repeated text. This computes the full range of equivalent anchors so such
 * edits can be treated as conflicting. Replacements cannot slide: changedSpan
 * trimming guarantees their boundaries mismatch the surrounding text.
 */
function slideZone(base: string, edit: TextEdit) {
  const removed = base.slice(edit.start, edit.end)
  const pattern = removed.length === 0 ? edit.insert : edit.insert.length === 0 ? removed : ''
  if (!pattern) return { ...edit, pattern, min: edit.start, max: edit.end, widened: false }
  const period = pattern.length
  let min = edit.start
  for (let k = 0; min > 0 && base[min - 1] === pattern[period - 1 - (k % period)]; k += 1) min -= 1
  let max = edit.end
  for (let k = 0; max < base.length && base[max] === pattern[k % period]; k += 1) max += 1
  return { ...edit, pattern, min, max, widened: min < edit.start || max > edit.end }
}

type Zone = ReturnType<typeof slideZone>

/**
 * When a slide zone only touches the other edit's span, the merge is still
 * safe as long as the ambiguity stops at the boundary: every anchor yields the
 * same result. It stays ambiguous only if the repeated pattern continues into
 * the text the neighbouring edit leaves at that boundary — then the same
 * final document could be produced by two different attributions.
 */
function ambiguousTouch(base: string, zone: Zone, other: TextEdit): boolean {
  if (!zone.widened) return false
  const period = zone.pattern.length
  if (other.end === zone.min && zone.min < zone.start) {
    const before = other.insert ? other.insert[other.insert.length - 1] : base[other.start - 1]
    return before === zone.pattern[period - 1 - ((zone.start - zone.min) % period)]
  }
  if (other.start === zone.max && zone.max > zone.end) {
    const after = other.insert ? other.insert[0] : base[other.end]
    return after === zone.pattern[(zone.max - zone.end) % period]
  }
  return false
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
  const localZone = slideZone(base, localEdit)
  const cloudZone = slideZone(base, cloudEdit)
  if ((localZone.widened || cloudZone.widened) && localZone.min < cloudZone.max && cloudZone.min < localZone.max) {
    return null
  }
  if (ambiguousTouch(base, localZone, cloudEdit) || ambiguousTouch(base, cloudZone, localEdit)) return null
  const edits = [localEdit, cloudEdit].sort((left, right) => right.start - left.start)
  return edits.reduce((result, edit) => `${result.slice(0, edit.start)}${edit.insert}${result.slice(edit.end)}`, base)
}
