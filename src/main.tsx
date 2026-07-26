import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import App from './App'
import { ToastViewport } from './components/shared/ToastViewport'
import { UiErrorBoundary } from './components/shared/UiErrorBoundary'
import { LanguageProvider } from './i18n'
import './styles/index.scss'

createRoot(document.getElementById('root')!).render(<StrictMode><LanguageProvider><UiErrorBoundary><App /></UiErrorBoundary><ToastViewport /></LanguageProvider></StrictMode>)
