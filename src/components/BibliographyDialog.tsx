import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, LoaderCircle, RefreshCw, SquareLibrary, X } from 'lucide-react'
import { scanBibliographySources, urlBibtex } from '../citations'

function fallbackDoiBibtex(doi: string): string {
  const key = `doi_${doi.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`
  return `@misc{${key},\n  doi = {${doi}},\n  url = {https://doi.org/${doi}}\n}`
}

function safeFileName(value: string): string {
  return `${value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'references'}.bib`
}

export function BibliographyDialog({ markdown, documentTitle, onClose }: { markdown: string; documentTitle: string; onClose: () => void }) {
  const sources = useMemo(() => scanBibliographySources(markdown), [markdown])
  const [reloadKey, setReloadKey] = useState(0)
  const [doiEntries, setDoiEntries] = useState<string[]>([])
  const [failedDois, setFailedDois] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

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
    <section className="bibliography-dialog" role="dialog" aria-modal="true" aria-labelledby="bibliography-title">
      <header>
        <div><SquareLibrary size={19} /><div><small>Derived from this document</small><h2 id="bibliography-title">Bibliography library</h2></div></div>
        <button onClick={onClose} aria-label="Close bibliography"><X size={18} /></button>
      </header>
      <div className="bibliography-summary">
        <span><strong>{sources.dois.length}</strong> DOI{sources.dois.length === 1 ? '' : 's'}</span>
        <span><strong>{sources.urls.length}</strong> web source{sources.urls.length === 1 ? '' : 's'}</span>
        <span><strong>{total}</strong> unique entries</span>
        <button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><RefreshCw className={loading ? 'is-spinning' : undefined} size={14} /> Rescan</button>
      </div>
      <div className="bibliography-content">
        {loading && !bibliography ? <div className="bibliography-empty"><LoaderCircle className="is-spinning" size={22} /><span>Resolving DOI metadata…</span></div> : bibliography ? <textarea value={bibliography} readOnly spellCheck={false} aria-label="Generated BibTeX bibliography" /> : <div className="bibliography-empty"><SquareLibrary size={24} /><strong>No citations found</strong><span>Add a DOI, Markdown link, or bare URL to the document.</span></div>}
        {!!failedDois.length && <p className="bibliography-warning">Metadata was unavailable for {failedDois.length} DOI{failedDois.length === 1 ? '' : 's'}; minimal DOI entries were generated instead.</p>}
      </div>
      <footer>
        <span>{loading ? `Resolving ${doiEntries.length} of ${sources.dois.length} DOI entries…` : 'BibTeX is generated from the current Markdown and is not stored separately.'}</span>
        <div><button onClick={() => void copyBibliography()} disabled={!bibliography}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy .bib'}</button><button className="bibliography-primary" onClick={downloadBibliography} disabled={!bibliography}><Download size={15} /> Download .bib</button></div>
      </footer>
    </section>
  </div>
}
