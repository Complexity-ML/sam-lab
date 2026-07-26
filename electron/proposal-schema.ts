export const proposalSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'summary', 'rationale', 'requires_human_review', 'confidence', 'writeback', 'evidence', 'actions'],
  properties: {
    title: { type: 'string' }, summary: { type: 'string' }, rationale: { type: 'string' }, requires_human_review: { type: 'boolean' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, writeback: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    actions: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['type', 'node_id', 'kind', 'label', 'description', 'owner', 'rule', 'source', 'target', 'source_handle', 'reason'], properties: {
      type: { type: 'string', enum: ['add_card', 'update_card', 'add_edge', 'remove_edge'] }, node_id: { type: ['string', 'null'] }, kind: { type: ['string', 'null'], enum: ['control', 'explorer', 'worker', 'query', 'source', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output', null] }, label: { type: ['string', 'null'] }, description: { type: ['string', 'null'] }, owner: { type: ['string', 'null'] }, rule: { type: ['string', 'null'] }, source: { type: ['string', 'null'] }, target: { type: ['string', 'null'] }, source_handle: { type: ['string', 'null'], enum: ['approved', 'quarantine', 'feedback', null] }, reason: { type: 'string' },
    } } },
  },
} as const
