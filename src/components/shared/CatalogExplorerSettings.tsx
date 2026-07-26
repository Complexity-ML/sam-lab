import { Gauge, RefreshCw } from 'lucide-react'
import { catalogExplorerPolicyRule, parseCatalogExplorerPolicy, type CatalogExplorerPolicy } from '../../domain/catalog-explorer-policy'
import type { PipelineNode } from '../../domain/pipeline'

export function CatalogExplorerSettings({ node, onUpdate }: {
  node: PipelineNode
  onUpdate(patch: Partial<PipelineNode['data']>): void
}) {
  const policy = parseCatalogExplorerPolicy(node.data.rule)
  const update = (patch: Partial<CatalogExplorerPolicy>, reset = false) => {
    const next = { ...policy, ...patch }
    onUpdate({
      rule: catalogExplorerPolicyRule(next),
      ...(reset ? { exploration: undefined, runState: 'idle', status: 'draft' } : {}),
    })
  }
  return <section className="explorer-settings">
    <header><Gauge size={15} /><span><strong>Exploration engine</strong><small>One atomic card · adjustable execution</small></span></header>
    <label>Scope<select aria-label="Catalog Explorer scope" value={policy.scope} onChange={(event) => update({ scope: event.target.value as CatalogExplorerPolicy['scope'], batchSize: event.target.value === 'dataset' ? 1 : Math.max(8, policy.batchSize), concurrency: event.target.value === 'dataset' ? 1 : Math.max(4, policy.concurrency) }, true)}>
      <option value="dataset">One dataset · fast path</option>
      <option value="all_datasets">Entire connected catalog</option>
    </select></label>
    {policy.scope === 'dataset' && <label>Dataset URN<input aria-label="Focused dataset URN" placeholder="urn:li:dataset:(…)" value={policy.datasetUrn} onChange={(event) => update({ datasetUrn: event.target.value }, true)} /></label>}
    <div className="explorer-settings-grid">
      <label>Batch size<input aria-label="Catalog batch size" max={32} min={1} type="number" value={policy.scope === 'dataset' ? 1 : policy.batchSize} disabled={policy.scope === 'dataset'} onChange={(event) => update({ batchSize: Number(event.target.value) })} /></label>
      <label>Workers<input aria-label="Catalog worker concurrency" max={8} min={1} type="number" value={policy.scope === 'dataset' ? 1 : policy.concurrency} disabled={policy.scope === 'dataset'} onChange={(event) => update({ concurrency: Number(event.target.value) })} /></label>
    </div>
    <label>Evidence cache<select aria-label="Catalog cache strategy" value={policy.cacheMode} onChange={(event) => update({ cacheMode: event.target.value as CatalogExplorerPolicy['cacheMode'] }, event.target.value === 'refresh')}>
      <option value="prefer">Prefer valid checkpoint</option>
      <option value="refresh">Force fresh evidence</option>
    </select></label>
    <div className="explorer-checkpoint-note"><strong>Versioned resume is always on</strong><small>Coverage continues without repeating completed reads.</small></div>
    <p><RefreshCw size={12} /> {policy.scope === 'dataset' ? 'Direct inspection: no catalog-wide discovery request.' : `${policy.concurrency} bounded workers inspect up to ${policy.batchSize} datasets per local iteration.`}</p>
  </section>
}
