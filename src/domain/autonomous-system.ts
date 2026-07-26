import { newCard, type PipelineNode } from './pipeline'
import { parseWorkerPolicy, workerPolicyRule } from './worker-policy'

export function ensureAutonomousSystemCards(nodes: PipelineNode[]) {
  let controller = nodes.find((node) => node.data.kind === 'control' && node.data.controlMode === 'autonomous-player')
  const added: PipelineNode[] = []
  if (!controller) {
    const created = newCard('control', nodes.length)
    controller = {
      ...created,
      data: {
        ...created.data,
        label: 'SAM LAB Controller',
        description: 'Global autonomous policy. It controls review checkpoints, automatic resume and idle monitoring without entering dataset lineage.',
        owner: 'SAM LAB Agent',
        status: 'healthy',
      },
    }
    added.push(controller)
  }
  if (!nodes.some((node) => node.data.kind === 'worker'
    && node.data.workerMode === 'bounded-execution'
    && parseWorkerPolicy(node.data.rule).role === 'exploration')) {
    const worker = newCard('worker', nodes.length + added.length)
    added.push({
      ...worker,
      data: {
        ...worker.data,
        label: 'Catalog Audit Worker',
        description: 'Runs bounded catalog inspection batches with branch-only context, checkpoint recovery and atomic results.',
        owner: 'SAM LAB Agent',
        status: 'healthy',
        rule: workerPolicyRule({
          role: 'exploration',
          batchSize: 8,
          concurrency: 4,
          retry: 'checkpoint',
          context: 'branch_only',
          merge: 'atomic',
        }),
      },
    })
  }
  if (!nodes.some((node) => node.data.kind === 'explorer' && node.data.explorerMode === 'catalog-fanout')) {
    const explorer = newCard('explorer', nodes.length + added.length)
    added.push({
      ...explorer,
      data: {
        ...explorer.data,
        label: 'DataHub Catalog Explorer',
        description: 'Discovers every governed dataset, audits metadata in parallel batches, checkpoints coverage and emits only evidence-backed incident branches.',
        owner: 'SAM LAB Agent',
        status: 'draft',
        exploration: {
          query: '*',
          total: 0,
          discovered: 0,
          inspected: 0,
          failed: 0,
          incidents: 0,
          governanceGaps: 0,
          concurrency: 4,
          batchSize: 8,
          remaining: 0,
          mode: 'catalog',
          cacheMode: 'prefer',
          phase: 'checkpoint',
          state: 'idle',
          checkpointAt: new Date().toISOString(),
          datasets: [],
        },
      },
    })
  }
  return { added, controller }
}
