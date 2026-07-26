import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react'

interface PanelScrollAreaProps {
  children: ReactNode
  className?: string
  label: string
  scrollPosition?: MutableRefObject<number>
}

export function PanelScrollArea({ children, className, label, scrollPosition }: PanelScrollAreaProps) {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (element.current && scrollPosition) element.current.scrollTop = scrollPosition.current
  }, [scrollPosition])
  return <div
    aria-label={label}
    className={`panel-scroll-area${className ? ` ${className}` : ''}`}
    onScroll={(event) => {
      if (scrollPosition) scrollPosition.current = event.currentTarget.scrollTop
    }}
    ref={element}
    role="region"
    tabIndex={0}
  >
    {children}
  </div>
}
