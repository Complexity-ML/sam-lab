import { useLanguage } from '../i18n'
import type { AgentPlayerState } from './AppHeader'

interface AppFooterProps {
  activity: string
  playerState: AgentPlayerState
}

export function AppFooter({ activity, playerState }: AppFooterProps) {
  const { t } = useLanguage()
  return <footer className="statusbar">
    <span className="status-activity">{activity}</span>
    <span className={`status-player state-${playerState}`}><i />Autonomous player · <strong>{playerState}</strong></span>
    <span className="status-review">{t('humanReview')} <strong>{t('notified')}</strong> {t('reviewWhen')}</span>
  </footer>
}
