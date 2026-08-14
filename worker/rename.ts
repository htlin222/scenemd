/**
 * Rename support. The document title follows the first H1 whenever one exists
 * (autosave derives title from the Markdown), so a rename that only touched
 * the stored title would be overwritten on the next save. Renaming therefore
 * rewrites the first H1 line too, keeping the two sources agreed.
 *
 * Pure and separate from index.ts so it can be tested outside the Workers
 * runtime, same as merge.ts.
 */
export function renameMarkdownTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    // Only a leading H1 acts as the document title; any other first block
    // means the title lives solely in metadata and the body stays untouched.
    const heading = line.match(/^(#\s+)(.*)$/)
    if (heading) lines[index] = `# ${title}`
    break
  }
  return lines.join('\n')
}
