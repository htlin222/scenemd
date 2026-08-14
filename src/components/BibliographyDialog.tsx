import { useEffect, useMemo, useState } from 'react'
import { Braces, Check, Copy, Download, ExternalLink, LayoutGrid, LoaderCircle, RefreshCw, SquareLibrary, X } from 'lucide-react'
import { scanBibliographySources, urlBibtex } from '../citations'
import { useModalFocus } from '../app/useModalFocus'

function fallbackDoiBibtex(doi: string): string {
  const key = `doi_${doi.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`
  return `@misc{${key},\n  doi = {${doi}},\n  url = {https://doi.org/${doi}}\n}`
}

function safeFileName(value: string): string {
  return `${value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'references'}.bib`
}

interface BibliographyCard {
  type: string
  key: string
  title: string
  authors: string
  venue: string
  year: string
  doi: string
  url: string
}

function bibtexFields(entry: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const pattern = /^\s*([a-z][\w-]*)\s*=\s*([{"])/gim
  let match: RegExpExecArray | null
  while ((match = pattern.exec(entry))) {
    const name = match[1].toLowerCase()
    const opener = match[2]
    const start = pattern.lastIndex
    let end = start
    if (opener === '{') {
      let depth = 1
      while (end < entry.length && depth > 0) {
        if (entry[end] === '{') depth += 1
        else if (entry[end] === '}') depth -= 1
        end += 1
      }
      fields[name] = entry.slice(start, Math.max(start, end - 1)).trim()
    } else {
      while (end < entry.length && (entry[end] !== '"' || entry[end - 1] === '\\')) end += 1
      fields[name] = entry.slice(start, end).trim()
      end += 1
    }
    pattern.lastIndex = end
  }
  return fields
}

function cleanBibtexValue(value = ''): string {
  return value.replace(/[{}]/g, '').replace(/\\([%&_#])/g, '$1').replace(/\s+/g, ' ').trim()
}

function bibliographyCard(entry: string): BibliographyCard {
  const identity = entry.match(/^\s*@([a-z]+)\s*{\s*([^,\s]+)/i)
  const fields = bibtexFields(entry)
  const doi = cleanBibtexValue(fields.doi)
  return {
    type: identity?.[1] ?? 'misc',
    key: identity?.[2] ?? 'reference',
    title: cleanBibtexValue(fields.title) || doi || 'Untitled reference',
    authors: cleanBibtexValue(fields.author).replace(/\s+and\s+/gi, ', '),
    venue: cleanBibtexValue(fields.journal || fields.booktitle || fields.publisher),
    year: cleanBibtexValue(fields.year || fields.date || fields.urldate),
    doi,
    url: cleanBibtexValue(fields.url) || (doi ? `https://doi.org/${doi}` : ''),
  }
}

export function BibliographyDialog({ markdown, documentTitle, onClose }: { markdown: string; documentTitle: string; onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDialogElement>()
  const sources = useMemo(() => scanBibliographySources(markdown), [markdown])
  const [reloadKey, setReloadKey] = useState(0)
  const [doiEntries, setDoiEntries] = useState<string[]>([])
  const [failedDois, setFailedDois] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<'cards' | 'raw'>(() => localStorage.getItem('scenemd-bibliography-view') === 'raw' ? 'raw' : 'cards')

  useEffect(() => localStorage.setItem('scenemd-bibliography-view', view), [view])

  useEffect(() => {
    const controller = new AbortController()
    setDoiEntries([])
    setFailedDois([])
    setLoading(true)
    void (async () => {
      const entries: string[] = []
      const failed: string[] = []
      for (const doi of sources.dois) {
        if (controller.signal.aborted) return
        try {
          const endpoint = new URL('/api/citations', window.location.origin)
          endpoint.searchParams.set('doi', doi)
          endpoint.searchParams.set('format', 'bibtex')
          const response = await fetch(endpoint, { signal: controller.signal })
          const result = await response.json() as { bibtex?: string; error?: string }
          if (!response.ok || !result.bibtex) throw new Error(result.error || 'BibTeX lookup failed')
          entries.push(result.bibtex.trim())
        } catch {
          if (controller.signal.aborted) return
          entries.push(fallbackDoiBibtex(doi))
          failed.push(doi)
        }
        setDoiEntries([...entries])
      }
      setFailedDois(failed)
      setLoading(false)
    })()
    return () => controller.abort()
  }, [sources, reloadKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const urlEntries = useMemo(() => sources.urls.map((entry, index) => urlBibtex(entry, index)), [sources.urls])
  const bibliography = [...doiEntries, ...urlEntries].join('\n\n')
  const cards = useMemo(() => [...doiEntries, ...urlEntries].map(bibliographyCard), [doiEntries, urlEntries])
  const total = sources.dois.length + sources.urls.length

  const copyBibliography = async () => {
    await navigator.clipboard.writeText(bibliography)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const downloadBibliography = () => {
    const url = URL.createObjectURL(new Blob([`${bibliography}\n`], { type: 'application/x-bibtex;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = safeFileName(documentTitle)
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <div className="bibliography-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <dialog open ref={dialogRef} className="bibliography-dialog" aria-modal="true" aria-labelledby="bibliography-title">
      <header>
        <div><SquareLibrary size={19} /><div><small>Derived from this document</small><h2 id="bibliography-title">Bibliography library</h2></div></div>
        <button onClick={onClose} aria-label="Close bibliography"><X size={18} /></button>
      </header>
      <div className="bibliography-summary">
        <span><strong>{sources.dois.length}</strong> DOI{sources.dois.length === 1 ? '' : 's'}</span>
        <span><strong>{sources.urls.length}</strong> web source{sources.urls.length === 1 ? '' : 's'}</span>
        <span><strong>{total}</strong> unique entries</span>
        <fieldset className="bibliography-view-switch" aria-label="Bibliography view"><button className={view === 'cards' ? 'is-active' : ''} onClick={() => setView('cards')} aria-pressed={view === 'cards'}><LayoutGrid size={14} /> Cards</button><button className={view === 'raw' ? 'is-active' : ''} onClick={() => setView('raw')} aria-pressed={view === 'raw'}><Braces size={14} /> Raw .bib</button></fieldset>
        <button className="bibliography-rescan" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><RefreshCw className={loading ? 'is-spinning' : undefined} size={14} /> Rescan</button>
      </div>
      <div className="bibliography-content">
        {loading && !bibliography ? <div className="bibliography-empty"><LoaderCircle className="is-spinning" size={22} /><span>Resolving DOI metadata…</span></div> : bibliography && view === 'raw' ? <textarea value={bibliography} readOnly spellCheck={false} aria-label="Generated BibTeX bibliography" /> : bibliography ? <div className="bibliography-card-grid">{cards.map((card, index) => <article className="bibliography-card" key={`${card.key}-${index}`}>
          <header><span>@{card.type}</span><code>{card.key}</code></header>
          <h3>{card.title}</h3>
          {card.authors && <p>{card.authors}</p>}
          <div>{card.venue && <span>{card.venue}</span>}{card.year && <span>{card.year}</span>}{card.doi && <span>DOI {card.doi}</span>}</div>
          {card.url && <a href={card.url} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} /></a>}
        </article>)}</div> : <div className="bibliography-empty"><SquareLibrary size={24} /><strong>No citations found</strong><span>Add a DOI, Markdown link, or bare URL to the document.</span></div>}
        {!!failedDois.length && <p className="bibliography-warning">Metadata was unavailable for {failedDois.length} DOI{failedDois.length === 1 ? '' : 's'}; minimal DOI entries were generated instead.</p>}
      </div>
      <footer>
        <span>{loading ? `Resolving ${doiEntries.length} of ${sources.dois.length} DOI entries…` : 'BibTeX is generated from the current Markdown and is not stored separately.'}</span>
        <div><button onClick={() => void copyBibliography()} disabled={!bibliography}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy .bib'}</button><button className="bibliography-primary" onClick={downloadBibliography} disabled={!bibliography}><Download size={15} /> Download .bib</button></div>
      </footer>
    </dialog>
  </div>
}
