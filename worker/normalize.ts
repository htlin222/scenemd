/**
 * Whitespace normalization applied when SceneMD stores markdown it authored
 * (autosave PATCH, document create). HackMD pulls stay verbatim — rewriting
 * externally-owned notes is not this module's call.
 *
 * Whitespace-only lines are blank lines to CommonMark, so collapsing a blank
 * run is render-neutral — except where blank lines are literal content:
 * inside fenced code blocks (skipped via fence tracking) and inside 4-space
 * indented code blocks (approximated by leaving any blank run alone when a
 * neighbouring line is indented like code). These lines are exactly the
 * repeated material the autosave merge can mis-anchor on and duplicate (see
 * merge.ts); normalizing writes removes that fuel and heals documents that
 * already accumulated whitespace runs between reference entries.
 */

const BLANK = /^[ \t]*$/
const CODE_INDENT = /^(?: {4}|\t)/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})[ \t]*$/

// A backtick fence's info string cannot contain further backticks — a line
// like "```inline``` text" is a paragraph, not an unclosed fence.
function fenceOpening(line: string): string | null {
  const tilde = line.match(/^\s*(~{3,})/)
  if (tilde) return tilde[1]
  const backtick = line.match(/^\s*(`{3,})[^`]*$/)
  return backtick ? backtick[1] : null
}

export function normalizeMarkdownWhitespace(markdown: string): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let fence: string | null = null
  let changed = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (fence) {
      result.push(line)
      const close = line.match(FENCE_CLOSE)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      continue
    }
    if (!BLANK.test(line)) {
      fence = fenceOpening(line)
      result.push(line)
      continue
    }
    let end = index
    while (end + 1 < lines.length && BLANK.test(lines[end + 1])) end += 1
    const run = lines.slice(index, end + 1)
    const nearIndentedCode = CODE_INDENT.test(result.at(-1) ?? '') || CODE_INDENT.test(lines[end + 1] ?? '')
    if (nearIndentedCode) {
      result.push(...run)
    } else {
      result.push('')
      changed ||= run.length > 1 || run[0].length > 0
    }
    index = end
  }

  return changed ? result.join('\n') : markdown
}
