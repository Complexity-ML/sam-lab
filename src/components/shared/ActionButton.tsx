import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function ActionButton({ children, className = '', icon, variant = 'secondary', type = 'button', ...props }: ActionButtonProps) {
  return <button className={`button ${variant} ${className}`.trim()} type={type} {...props}>{icon}{children}</button>
}
