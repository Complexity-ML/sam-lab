import { Boxes, LoaderCircle, Pause, Play, Settings, Square } from 'lucide-react'
import type { WorkspaceSaveState } from '../domain/workspace'
import { useLanguage } from '../i18n'

export type AgentPlayerState = 'stopped' | 'running' | 'paused'

interface AppHeaderProps {
  agentBusy: boolean
  cardCount: number
  onOpenSettings(): void
  onPause(): void
  onPlay(): void
  onStop(): void
  playerState: AgentPlayerState
  projectTitle: string
  reviewPending: boolean
  saveState: WorkspaceSaveState
}

export function AppHeader({ agentBusy, cardCount, onOpenSettings, onPause, onPlay, onStop, playerState, projectTitle, reviewPending, saveState }: AppHeaderProps) {
  const { t } = useLanguage()
  return <header className="topbar">
    <div className="brand"><span className="brand-mark"><Boxes size={18} /></span><div><strong>SAM LAB</strong><small>{t('appSubtitle')}</small></div></div>
    <div className="project-title"><span>{projectTitle}</span><small className={`header-save-state ${saveState}`}>{saveState === 'recovering' ? t('recoveryAvailable') : saveState === 'saved' ? t('saved') : `${t('unsaved')}${cardCount === 0 ? ` · ${t('emptyCanvas')}` : ''}`}</small></div>
    <div className="topbar-actions">
      <div aria-label="Autonomous agent player" className={`agent-player state-${playerState}`} role="group">
        <span aria-live="polite" className="agent-player-state"><i />{playerState === 'running' ? 'Running' : playerState === 'paused' ? 'Paused' : 'Stopped'}</span>
        <button aria-label="Play autonomous agent" disabled={playerState === 'running' || agentBusy || reviewPending} onClick={onPlay} title={reviewPending ? 'Resolve the pending Human Review first' : cardCount === 0 ? 'Discover the best available governed source and start the autonomous graph' : t('runHint')} type="button"><Play size={13} /><span>{t('runAgent')}</span></button>
        <button aria-label="Pause autonomous agent" disabled={playerState !== 'running'} onClick={onPause} title="Finish the current atomic iteration, then pause" type="button">{agentBusy ? <LoaderCircle className="agent-context-wheel" size={13} /> : <Pause size={13} />}<span>{t('pauseAgent')}</span></button>
        <button aria-label="Stop autonomous agent" disabled={playerState === 'stopped' && !agentBusy} onClick={onStop} title="Cancel the current run and stop monitoring" type="button"><Square size={12} /><span>{t('stopAgent')}</span></button>
      </div>
      <button aria-label={t('openSettings')} className="settings-trigger" onClick={onOpenSettings} title={t('openSettings')} type="button"><Settings size={17} /></button>
    </div>
  </header>
}
