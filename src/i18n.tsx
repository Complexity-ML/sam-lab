import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type AppLanguage = 'en' | 'fr'

const messages = {
  en: {
    appSubtitle: 'Software asset intelligence studio',
    recoveryAvailable: 'Recovery available', saved: 'Saved', unsaved: 'Unsaved', emptyCanvas: 'empty canvas',
    runAgent: 'Play', agentWorking: 'Agent working…', runHint: 'Start autonomous SAM analysis', pauseAgent: 'Pause', stopAgent: 'Stop', addSourceHint: 'Add an Asset Source card before running the SAM workflow', openSettings: 'Open settings',
    promptPlaceholder: 'Ask the agent to analyze, optimize or review this software portfolio…', promptDisconnected: 'Connect ChatGPT or an API provider in Settings to activate the agent…',
    connectSource: 'Connect an AI source before sending. Your prompt is preserved.', agentLabel: 'SAM LAB agent', noAction: 'No simulated action · connection required', connect: 'Connect', send: 'Send request to SAM LAB agent', details: 'Show agentic details',
    humanReview: 'Human review', notified: 'notified', reviewWhen: 'when Agent Decision requests it',
  },
  fr: {
    appSubtitle: 'Studio intelligent de gestion des actifs logiciels',
    recoveryAvailable: 'Récupération disponible', saved: 'Enregistré', unsaved: 'Non enregistré', emptyCanvas: 'canvas vide',
    runAgent: 'Play', agentWorking: 'Agent en cours…', runHint: 'Démarrer l’analyse SAM autonome', pauseAgent: 'Pause', stopAgent: 'Stop', addSourceHint: 'Ajoutez une carte Source d’actifs avant de lancer le workflow SAM', openSettings: 'Ouvrir les réglages',
    promptPlaceholder: 'Demandez à l’agent d’analyser, optimiser ou revoir ce portefeuille logiciel…', promptDisconnected: 'Connectez ChatGPT ou un fournisseur API dans les réglages pour activer l’agent…',
    connectSource: 'Connectez une source IA avant l’envoi. Votre prompt est conservé.', agentLabel: 'Agent SAM LAB', noAction: 'Aucune action simulée · connexion requise', connect: 'Connecter', send: 'Envoyer la demande à l’agent SAM LAB', details: 'Afficher les détails agentiques',
    humanReview: 'Revue humaine', notified: 'notifiée', reviewWhen: 'quand Agent Decision la demande',
  },
} as const

export type MessageKey = keyof typeof messages.en

interface LanguageContextValue {
  language: AppLanguage
  setLanguage(language: AppLanguage): void
  t(key: MessageKey): string
}

const LanguageContext = createContext<LanguageContextValue>({ language: 'en', setLanguage: () => undefined, t: (key) => messages.en[key] })

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => window.localStorage.getItem('sam-lab-language') === 'fr' ? 'fr' : 'en')
  const setLanguage = (nextLanguage: AppLanguage) => {
    window.localStorage.setItem('sam-lab-language', nextLanguage)
    setLanguageState(nextLanguage)
  }
  useEffect(() => { document.documentElement.lang = language }, [language])
  const value = useMemo<LanguageContextValue>(() => ({ language, setLanguage, t: (key) => messages[language][key] }), [language])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() { return useContext(LanguageContext) }
