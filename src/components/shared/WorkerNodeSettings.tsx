import type { PipelineNode } from '../../domain/pipeline'
import { parseWorkerPolicy, workerPolicyRule, type WorkerPolicy, type WorkerRole } from '../../domain/worker-policy'

const roles: Array<{ value: WorkerRole; label: string }> = [
  { value: 'generic', label: 'Generic work' },
  { value: 'exploration', label: 'Exploration' },
  { value: 'audit', label: 'Audit' },
  { value: 'risk', label: 'Risk analysis' },
  { value: 'incident', label: 'Incident response' },
  { value: 'patch', label: 'Graph patch' },
]

export function WorkerNodeSettings({ node, onUpdate }: { node: PipelineNode; onUpdate(patch: Partial<PipelineNode['data']>): void }) {
  const policy = parseWorkerPolicy(node.data.rule)
  const update = (patch: Partial<WorkerPolicy>) => onUpdate({ rule: workerPolicyRule({ ...policy, ...patch }) })

  return <section className="worker-node-settings">
    <div><small>WORKER POLICY</small><strong>Bounded parallel execution</strong><p>The node processes deterministic batches with branch-only context and an atomic merge.</p></div>
    <label>Role<select value={policy.role} onChange={(event) => update({ role: event.target.value as WorkerRole })}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
    <div className="worker-setting-grid">
      <label>Batch size<input max={32} min={1} onChange={(event) => update({ batchSize: Number(event.target.value) })} type="number" value={policy.batchSize} /></label>
      <label>Concurrency<input max={8} min={1} onChange={(event) => update({ concurrency: Number(event.target.value) })} type="number" value={policy.concurrency} /></label>
    </div>
    <label>Failure recovery<select value={policy.retry} onChange={(event) => update({ retry: event.target.value as WorkerPolicy['retry'] })}><option value="checkpoint">Resume checkpoint</option><option value="none">Stop without retry</option></select></label>
    <div className="worker-setting-grid">
      <label>Maximum retries<input max={10} min={1} onChange={(event) => update({ maxRetries: Number(event.target.value) })} type="number" value={policy.maxRetries ?? 3} /></label>
      <label>Cooldown (seconds)<input max={3600} min={5} onChange={(event) => update({ cooldownSeconds: Number(event.target.value) })} type="number" value={policy.cooldownSeconds ?? 30} /></label>
    </div>
  </section>
}
