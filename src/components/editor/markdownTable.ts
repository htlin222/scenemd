export function parseDelimitedTable(value: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') {
      if (quoted && value[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1
      row.push(cell); cell = ''
      if (row.some((entry) => entry.trim())) rows.push(row)
      row = []
    } else {
      cell += character
    }
  }
  row.push(cell)
  if (row.some((entry) => entry.trim())) rows.push(row)
  return rows
}

export function tableFromHtml(html: string): string[][] {
  if (!html.trim()) return []
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const table = parsed.querySelector('table')
  if (!table) return []
  return [...table.querySelectorAll('tr')].map((row) => [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) => {
    const clone = cell.cloneNode(true) as HTMLElement
    clone.querySelectorAll('br').forEach((breakElement) => breakElement.replaceWith(' · '))
    return clone.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  })).filter((row) => row.length > 0)
}

export function detectPastedTable(source: string, clipboardHtml = ''): { rows: string[][]; format: 'Word / HTML' | 'TSV' | 'CSV' | null } {
  const htmlRows = tableFromHtml(clipboardHtml || (/<table[\s>]/i.test(source) ? source : ''))
  if (htmlRows.length) return { rows: htmlRows, format: 'Word / HTML' }
  if (source.includes('\t')) return { rows: parseDelimitedTable(source, '\t'), format: 'TSV' }
  const csvRows = parseDelimitedTable(source, ',')
  if (csvRows.length && csvRows.some((row) => row.length > 1)) return { rows: csvRows, format: 'CSV' }
  return { rows: [], format: null }
}

export function markdownTableFromRows(rows: string[][]): string {
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  if (!rows.length || columnCount < 2) return ''
  const cleanCell = (cell = '') => cell.trim().replace(/\|/g, '\\|').replace(/\r?\n/g, ' · ')
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => cleanCell(row[index])))
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

