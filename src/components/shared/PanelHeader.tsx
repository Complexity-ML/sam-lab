import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface PanelHeaderProps {
  eyebrow: string
  title: string
  titleId?: string
  action?: ReactNode
}

export function PanelHeader({ action, eyebrow, title, titleId }: PanelHeaderProps) {
  return <div className="panel-heading"><div><small>{eyebrow}</small><h2 id={titleId}>{title}</h2></div>{action}</div>
}

export function PanelHeaderActions({ children }: { children: ReactNode }) {
  return <div className="panel-heading-actions">{children}</div>
}

export function PanelFooterActions({ children }: { children: ReactNode }) {
  return <div className="panel-footer-actions">{children}</div>
}

interface PanelHeaderButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode
  label: string
}

export function PanelHeaderButton({ children, className = '', label, title = label, type = 'button', ...props }: PanelHeaderButtonProps) {
  return <button
    aria-label={label}
    className={`panel-toggle ${className}`.trim()}
    title={title}
    type={type}
    {...props}
  >{children}</button>
}
