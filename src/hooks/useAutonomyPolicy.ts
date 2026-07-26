import { useEffect, useState } from 'react'
import { defaultAutonomyPolicy, normalizeAutonomyPolicy } from '../domain/autonomy-policy'

const storageKey = 'sam-lab-autonomy-policy'

function storedPolicy() {
  try { return normalizeAutonomyPolicy(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')) }
  catch { return defaultAutonomyPolicy }
}

export function useAutonomyPolicy() {
  const [policy, setPolicy] = useState(storedPolicy)
  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(policy))
  }, [policy])
  return [policy, setPolicy] as const
}
