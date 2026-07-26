export type ConnectivityFailureKind = 'offline' | 'dns' | 'refused' | 'timeout' | 'authentication' | 'tls'

export interface ConnectivityIncident {
  kind: ConnectivityFailureKind
  title: string
  detail: string
  fingerprint: string
  sourceSystem: 'SAM LAB connectivity'
}

function failureText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return [value.name, value.message, failureText(value.cause)].filter(Boolean).join(' · ')
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>
    return [candidate.code, candidate.name, candidate.message, candidate.cause].map(failureText).filter(Boolean).join(' · ')
  }
  return value === undefined || value === null ? '' : String(value)
}

export function classifyConnectivityFailure(value: unknown, target: string): ConnectivityIncident | undefined {
  const message = failureText(value)
  const normalized = message.toLowerCase()
  const common = { sourceSystem: 'SAM LAB connectivity' as const }
  if (/(?:err_internet_disconnected|enetunreach|ehostunreach|network is unreachable|internet connection appears? offline|not connected to (?:the )?internet|network request failed|failed to fetch|can'?t assign requested address)/i.test(message)) {
    return {
      ...common,
      kind: 'offline',
      title: `No network · ${target} unreachable`,
      detail: `SAM LAB cannot reach ${target} because no usable network route is available. Dataset health was not evaluated. Check Wi-Fi, Ethernet or VPN, then retry.`,
      fingerprint: 'connectivity:offline',
    }
  }
  if (/(?:enotfound|eai_again|getaddrinfo|dns|name or service not known|could not resolve host)/i.test(message)) {
    return {
      ...common,
      kind: 'dns',
      title: `DNS failure · ${target} unreachable`,
      detail: `SAM LAB cannot resolve ${target}. Dataset health was not evaluated. Check DNS, VPN and the configured hostname, then retry.`,
      fingerprint: 'connectivity:dns',
    }
  }
  if (/(?:econnrefused|connection refused|actively refused)/i.test(message)) {
    return {
      ...common,
      kind: 'refused',
      title: `Connection refused · ${target}`,
      detail: `${target} rejected the connection. Dataset health was not evaluated. Verify that the service is running, its port is reachable and the configured URL is correct.`,
      fingerprint: 'connectivity:refused',
    }
  }
  if (/(?:certificate|self[- ]signed|unable to verify|cert_|tls|ssl)/i.test(message)) {
    return {
      ...common,
      kind: 'tls',
      title: `Secure connection failed · ${target}`,
      detail: `SAM LAB could not establish a trusted TLS connection to ${target}. Dataset health was not evaluated. Verify the certificate chain, proxy and system clock.`,
      fingerprint: 'connectivity:tls',
    }
  }
  if (/(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid token|authentication failed)/i.test(message)) {
    return {
      ...common,
      kind: 'authentication',
      title: `Authentication failed · ${target}`,
      detail: `${target} is reachable but rejected the credentials. Dataset health was not evaluated. Refresh the scoped token or account connection, then retry.`,
      fingerprint: 'connectivity:authentication',
    }
  }
  if (/(?:timed? out|etimedout|aborterror|deadline exceeded)/i.test(message) || normalized.includes('timeout')) {
    return {
      ...common,
      kind: 'timeout',
      title: `Connection timed out · ${target}`,
      detail: `${target} did not answer before the bounded timeout. Dataset health was not evaluated. This is collection-reliability evidence, not a dataset anomaly. Check the network and service health, then retry.`,
      fingerprint: 'connectivity:timeout',
    }
  }
  return undefined
}
