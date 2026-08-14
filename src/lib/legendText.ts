export interface ImageLegendContext {
  paragraphFrom: number
  paragraphTo: number
  legend: string
  editable: boolean
}

// Lines that start a different Markdown block: the legend paragraph must never
// grow across these, or saving would overwrite a neighboring heading or list.
const BLOCK_INTERRUPTER = /^\s*(?:#{1,6}\s|>|(?:[-+*]|\d+[.)])\s|```|~~~|\||<!--|---\s*$|\$\$)/

const IMAGE_SYNTAX = /!\[[^\]\n]*\]\([^)\n]*\)/g

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

interface Line {
  start: number
  end: number
  text: string
}

function sourceLines(source: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (const text of source.split('\n')) {
    lines.push({ start, end: start + text.length, text })
    start += text.length + 1
  }
  return lines
}

export function readImageLegend(source: string, imageFrom: number, imageTo: number): ImageLegendContext {
  const lines = sourceLines(source)
  const imageLine = lines.find((line) => imageFrom >= line.start && imageFrom <= line.end)
  const notEditable = { paragraphFrom: imageFrom, paragraphTo: imageTo, legend: '', editable: false }
  if (!imageLine || BLOCK_INTERRUPTER.test(imageLine.text)) return notEditable

  const imageIndex = lines.indexOf(imageLine)
  const partOfParagraph = (line: Line) => Boolean(line.text.trim()) && !BLOCK_INTERRUPTER.test(line.text)
  let first = imageIndex
  while (first > 0 && partOfParagraph(lines[first - 1])) first -= 1
  let last = imageIndex
  while (last < lines.length - 1 && partOfParagraph(lines[last + 1])) last += 1

  const paragraphFrom = lines[first].start
  const paragraphTo = lines[last].end
  const paragraph = source.slice(paragraphFrom, paragraphTo)
  if ((paragraph.match(IMAGE_SYNTAX)?.length ?? 0) > 1) return notEditable
  const legend = collapseWhitespace(source.slice(paragraphFrom, imageFrom) + ' ' + source.slice(imageTo, paragraphTo))
  return { paragraphFrom, paragraphTo, legend, editable: true }
}

export function imageParagraphReplacement(
  source: string,
  imageFrom: number,
  imageTo: number,
  imageSyntax: string,
  legend: string,
): { from: number; to: number; insert: string } {
  const context = readImageLegend(source, imageFrom, imageTo)
  if (!context.editable) return { from: imageFrom, to: imageTo, insert: imageSyntax }
  const collapsed = collapseWhitespace(legend)
  return {
    from: context.paragraphFrom,
    to: context.paragraphTo,
    insert: collapsed ? `${imageSyntax} ${collapsed}` : imageSyntax,
  }
}
