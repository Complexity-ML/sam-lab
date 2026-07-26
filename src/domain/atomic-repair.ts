export interface AtomicRepairState {
  attempts: number
  blockerFingerprint: string
  sessionId: number
}

export interface AtomicRepairPlan {
  blockerFingerprint: string
  exhausted: boolean
  nextState: AtomicRepairState
  shouldRetry: boolean
}

export const maximumAtomicRepairAttempts = 1

export function atomicBlockerFingerprint(blockerIds: string[]) {
  return [...new Set(blockerIds.filter(Boolean))].sort().join('|')
}

export function planAtomicRepair(
  previous: AtomicRepairState | undefined,
  sessionId: number,
  blockerIds: string[],
  maximumAttempts = maximumAtomicRepairAttempts,
): AtomicRepairPlan {
  const blockerFingerprint = atomicBlockerFingerprint(blockerIds)
  const attempts = previous?.sessionId === sessionId ? previous.attempts : 0
  const shouldRetry = blockerFingerprint.length > 0 && attempts < Math.max(0, maximumAttempts)
  const nextState = {
    attempts: attempts + (shouldRetry ? 1 : 0),
    blockerFingerprint,
    sessionId,
  }
  return {
    blockerFingerprint,
    exhausted: blockerFingerprint.length > 0 && !shouldRetry,
    nextState,
    shouldRetry,
  }
}
