import { Bot, Database, GitCompareArrows, History, ListChecks, LoaderCircle, Send, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useLanguage } from '../../i18n'

interface AgentPromptProps {
  activity: string
  agentLabel?: string
  ariaLabel?: string
  busy: boolean
  connected: boolean
  context: { ai?: string; cards: number; edges: number; versions: number; mcp: string; model: string }
  placeholder?: string
  submitLabel?: string
  onOpenSettings(): void
  onStop(): void
  onSubmit(prompt: string): void
}

export function AgentPrompt({ activity, agentLabel, ariaLabel, busy, connected, context, onOpenSettings, onStop, onSubmit, placeholder, submitLabel }: AgentPromptProps) {
  const { t } = useLanguage()
  const [value, setValue] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const height = Math.min(Math.max(textarea.scrollHeight, 32), 88)
    textarea.style.height = `${height}px`
    textarea.style.overflowY = textarea.scrollHeight > 88 ? 'auto' : 'hidden'
  }, [value])

  const submit = () => {
    const request = value.trim()
    if (!request || busy) return
    if (!connected) {
      setConnectionNotice(t('connectSource'))
      return
    }
    setConnectionNotice('')
    onSubmit(request)
    setValue('')
    setDetailsOpen(true)
  }

  return <div className="data-agent-prompt-dock">
    {detailsOpen && <section aria-label="Agentic execution details" className="data-agent-details">
      <header><span><Sparkles size={14} /><strong>Agentic context</strong></span><button aria-label="Close agent details" onClick={() => setDetailsOpen(false)} type="button"><X size={13} /></button></header>
      <div className="agent-context-flow">
        <span><Database size={14} /><strong>DataHub MCP</strong><small>{context.mcp}</small></span>
        <i>→</i>
        <span className={busy ? 'is-running' : ''}>{busy ? <LoaderCircle aria-hidden="true" className="agent-context-wheel" size={16} /> : <Bot size={14} />}<strong>AI provider</strong><small>{busy ? activity : context.ai ?? context.model}</small></span>
        <i>→</i>
        <span><History size={14} /><strong>Version memory</strong><small>{context.versions} checkpoint{context.versions === 1 ? '' : 's'}</small></span>
        <i>→</i>
        <span><GitCompareArrows size={14} /><strong>Graph proposal</strong><small>{context.cards} cards · {context.edges} edges</small></span>
        <i>→</i>
        <span><ShieldCheck size={14} /><strong>Human Review</strong><small>Atomic approval</small></span>
      </div>
      <p className={busy ? 'is-running' : ''}>{busy && <LoaderCircle aria-hidden="true" className="agent-context-wheel" size={13} />}{activity}</p>
    </section>}
    <form className="data-agent-prompt" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <textarea
        aria-label={ariaLabel ?? 'What should the SAM LAB agent do?'}
        disabled={busy}
        id="sam-lab-agent-prompt"
        onChange={(event) => { setValue(event.target.value); if (connectionNotice) setConnectionNotice('') }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        }}
        placeholder={connected ? placeholder ?? t('promptPlaceholder') : t('promptDisconnected')}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      <div className="data-agent-prompt-context"><span><Sparkles size={11} />{agentLabel ?? t('agentLabel')}</span><small aria-live="polite">{connectionNotice || (connected ? `${context.model} · Review only · ${context.mcp}` : t('noAction'))}</small>{!connected && <button className="data-agent-connect" onClick={onOpenSettings} type="button">{t('connect')}</button>}</div>
      <div className="data-agent-actions">
        {busy
          ? <button aria-label="Emergency stop agent" className="data-agent-send is-stop" onClick={onStop} title="Stop the current agent run immediately" type="button"><Square size={13} /></button>
          : <button aria-label={submitLabel ?? t('send')} className="data-agent-send" disabled={!value.trim()} title={connected ? 'Ask without changing the graph' : t('openSettings')} type="submit"><Send size={15} /></button>}
        <button aria-expanded={detailsOpen} aria-label={t('details')} className="data-agent-detail-button" onClick={() => setDetailsOpen((current) => !current)} title={t('details')} type="button"><ListChecks size={14} /><b>{busy ? '…' : context.versions}</b></button>
      </div>
    </form>
  </div>
}
