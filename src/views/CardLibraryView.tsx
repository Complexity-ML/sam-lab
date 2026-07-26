import { Binoculars, Bot, Braces, BrainCircuit, ChartColumn, ChartNetwork, Cpu, Database, Dices, FileDiff, GitBranch, LayoutDashboard, Network, PanelLeftClose, Plus, Radar, SearchCheck, Send, ShieldAlert, UserCheck, WandSparkles } from 'lucide-react'
import { PanelHeader } from '../components/shared/PanelHeader'
import { PanelScrollArea } from '../components/shared/PanelScrollArea'
import { cardLabels, type CardKind } from '../domain/pipeline'

const palette: { kind: CardKind; description: string; icon: typeof Database }[] = [
  { kind: 'control', description: 'Persistent portfolio policy and autonomous loop', icon: Bot },
  { kind: 'explorer', description: 'Discover software, contracts and subscriptions', icon: Binoculars },
  { kind: 'worker', description: 'Audit assets in bounded reusable batches', icon: Cpu },
  { kind: 'query', description: 'Match entitlements, assignments and usage evidence', icon: Braces },
  { kind: 'source', description: 'SaaS, CMDB, contract, invoice or HR inventory', icon: Database },
  { kind: 'profile', description: 'Version normalized asset and license evidence', icon: ChartColumn },
  { kind: 'analysis', description: 'Detect unused, duplicate and underused licenses', icon: BrainCircuit },
  { kind: 'impact', description: 'Calculate spend, waste and renewal exposure', icon: ChartNetwork },
  { kind: 'risk', description: 'Classify compliance, cost, security and renewal risk', icon: ShieldAlert },
  { kind: 'patch', description: 'Propose a reversible optimization plan', icon: FileDiff },
  { kind: 'monitor', description: 'Restart when inventory or contract evidence changes', icon: Radar },
  { kind: 'parallel', description: 'Delegate independent vendor or business-unit audits', icon: Network },
  { kind: 'diagram', description: 'Merge reviewed portfolio branches atomically', icon: LayoutDashboard },
  { kind: 'split', description: 'Route keep, reclaim and investigate branches', icon: GitBranch },
  { kind: 'decision', description: 'Autonomous recommendation or human escalation', icon: Dices },
  { kind: 'transform', description: 'Normalize vendors, products, editions and SKUs', icon: WandSparkles },
  { kind: 'review', description: 'Ask an owner before a material SAM action', icon: UserCheck },
  { kind: 'validation', description: 'Check entitlement, policy and approval contracts', icon: SearchCheck },
  { kind: 'output', description: 'Optimization report, renewal plan or action export', icon: Send },
]

export function CardLibraryView({ onAddCard, onClose }: { onAddCard(kind: CardKind): void; onClose(): void }) {
  return <aside className="library-panel">
    <PanelHeader action={<button aria-label="Close card library" className="panel-toggle" onClick={onClose} title="Close card library" type="button"><PanelLeftClose size={16} /></button>} eyebrow="BUILD" title="Card library" />
    <PanelScrollArea className="library-panel-content" label="Card library content">
      <p className="panel-intro">Compose an auditable Software Asset Management workflow. Every decision remains inspectable and reviewable.</p>
      <div className="palette-list">{palette.map(({ kind, description, icon: Icon }) => <button
        className={`palette-card palette-${kind}`}
        draggable
        key={kind}
        onClick={() => onAddCard(kind)}
        onDragEnd={(event) => event.currentTarget.classList.remove('is-dragging')}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('application/sam-lab-card', kind)
          event.dataTransfer.setData('text/plain', cardLabels[kind])
          event.currentTarget.classList.add('is-dragging')
        }}
        title={`Click to add or drag ${cardLabels[kind]} onto the canvas`}
        type="button"
      ><span><Icon size={16} /></span><div><strong>{cardLabels[kind]}</strong><small>{description}</small></div><Plus size={14} /></button>)}</div>
      <section className="datahub-context">
        <div><Database size={15} /><strong>SAM evidence</strong></div>
        <p>Inventory, entitlements, contracts, usage and ownership are normalized before the agent proposes a reclaim, renewal or compliance action.</p>
        <ul><li>software inventory</li><li>license contracts</li><li>usage signals</li></ul>
      </section>
    </PanelScrollArea>
  </aside>
}
