import { AlertTriangle, CheckCircle2, Database, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { DataHubAssetSummary } from '../../domain/datahub'
import { ActionButton } from './ActionButton'

interface DataHubAssetPickerProps {
  connected: boolean
  onBind(asset: DataHubAssetSummary): void
  onInspect(urn: string, force?: boolean): Promise<{ asset: DataHubAssetSummary }>
  onOpenSettings(): void
  onSearch(query: string): Promise<DataHubAssetSummary[]>
}

export function DataHubAssetPicker({ connected, onBind, onInspect, onOpenSettings, onSearch }: DataHubAssetPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DataHubAssetSummary[]>([])
  const [preview, setPreview] = useState<DataHubAssetSummary>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Search every enabled catalog connection; no vendor-specific reference paste is required.')

  const search = async (event: FormEvent) => {
    event.preventDefault()
    if (!connected) {
      setMessage('Add a catalog connection before searching. Your query is preserved.')
      return
    }
    setBusy(true)
    setPreview(undefined)
    setMessage('Searching enabled catalog connections in parallel…')
    try {
      const matches = await onSearch(query)
      setResults(matches)
      setMessage(matches.length ? `${matches.length} dataset${matches.length === 1 ? '' : 's'} found. Select one to inspect before binding.` : 'No accessible dataset matched this search.')
    } catch (error) {
      setResults([])
      setMessage(error instanceof Error ? error.message : 'Catalog search failed.')
    } finally { setBusy(false) }
  }

  const inspect = async (urn: string, force = false) => {
    setBusy(true)
    setMessage(force ? 'Refreshing schema, governance and lineage…' : 'Loading trusted schema and classifications…')
    try {
      const detail = await onInspect(urn, force)
      setPreview(detail.asset)
      setMessage(detail.asset.freshness.stale ? 'Metadata is stale; refresh before binding sensitive data.' : 'Preview ready. Confirm to bind this dataset atomically.')
    } catch (error) {
      setPreview(undefined)
      setMessage(error instanceof Error ? error.message : 'This dataset is inaccessible.')
    } finally { setBusy(false) }
  }

  return <section className="datahub-picker">
    <header><span><Database size={15} /><strong>Catalog source</strong></span>{!connected && <button onClick={onOpenSettings} type="button">Add connection</button>}</header>
    <form onSubmit={search}><input aria-label="Search catalog datasets" onChange={(event) => setQuery(event.target.value)} placeholder="customers, orders, tag:PII…" value={query} /><button aria-label="Search catalog" disabled={busy || query.trim().length < 2} type="submit"><Search size={14} /></button></form>
    <p aria-live="polite" className="datahub-picker-message">{message}</p>
    {results.length > 0 && <ol className="datahub-search-results">{results.map((asset) => <li key={`${asset.connectorId ?? 'datahub'}:${asset.urn}`}><button aria-current={preview?.urn === asset.urn ? 'true' : undefined} disabled={busy} onClick={() => void inspect(asset.urn)} type="button"><span><strong>{asset.name}</strong><small>{asset.sourceSystem ?? 'DataHub'} · {asset.platform} · {asset.environment}</small></span><em>{asset.owners[0] ?? 'Owner unavailable'}</em><p>{asset.description}</p></button></li>)}</ol>}
    {preview && <article className="datahub-asset-preview">
      <header><div><small>PREVIEW BEFORE BINDING</small><h4>{preview.name}</h4><code>{preview.urn}</code></div><button aria-label="Refresh DataHub metadata" disabled={busy} onClick={() => void inspect(preview.urn, true)} type="button"><RefreshCw size={13} /></button></header>
      <dl><div><dt>Owner</dt><dd>{preview.owners.join(', ') || 'Unavailable'}</dd></div><div><dt>Domain</dt><dd>{preview.domain ?? 'Unavailable'}</dd></div><div><dt>Quality</dt><dd className={`quality-${preview.qualityStatus}`}>{preview.qualityStatus === 'failing' ? <AlertTriangle size={12} /> : preview.qualityStatus === 'healthy' ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}{preview.qualityStatus}</dd></div><div><dt>Freshness</dt><dd>{preview.freshness.stale ? 'Stale' : `Fresh until ${new Date(preview.freshness.expiresAt).toLocaleTimeString()}`}</dd></div></dl>
      <div className="datahub-preview-tags">{preview.tags.length ? preview.tags.map((tag) => <span key={tag}>{tag}</span>) : <small>No classifications available</small>}</div>
      <div className="datahub-preview-schema"><strong>Schema · {preview.fields.length} fields</strong>{preview.fields.slice(0, 8).map((field) => <span key={field.name}><code>{field.name}</code><em>{field.type}</em>{field.tags?.map((tag) => <b key={tag}>{tag}</b>)}</span>)}{preview.fields.length > 8 && <small>+ {preview.fields.length - 8} more fields</small>}</div>
      <div className="datahub-preview-lineage"><span>↑ {preview.upstream.length} upstream</span><span>↓ {preview.downstream.length} downstream</span>{[...preview.upstream, ...preview.downstream].some((item) => item.sensitive) && <em><ShieldAlert size={11} />Sensitive path</em>}</div>
      <ActionButton disabled={busy || preview.freshness.stale} onClick={() => onBind(preview)} variant="primary">Bind this catalog source</ActionButton>
    </article>}
  </section>
}
