import { describe, expect, it } from 'vitest'
import { classifyConnectivityFailure } from './connectivity'

describe('connectivity incident classification', () => {
  it.each([
    ['offline', new Error('connect ENETUNREACH 10.0.0.1'), 'No network'],
    ['dns', new Error('getaddrinfo ENOTFOUND datahub.internal'), 'DNS failure'],
    ['refused', new Error('connect ECONNREFUSED 127.0.0.1:8080'), 'Connection refused'],
    ['timeout', new Error('get_entities timed out after 20s'), 'Connection timed out'],
    ['authentication', new Error('HTTP 401 Unauthorized'), 'Authentication failed'],
    ['tls', new Error('self-signed certificate in certificate chain'), 'Secure connection failed'],
  ])('classifies %s without claiming a dataset anomaly', (kind, error, title) => {
    const incident = classifyConnectivityFailure(error, 'DataHub')
    expect(incident).toMatchObject({ kind, sourceSystem: 'SAM LAB connectivity' })
    expect(incident?.title).toContain(title)
    expect(incident?.detail).toContain('Dataset health was not evaluated')
  })

  it('does not misclassify an ordinary data validation error as connectivity', () => {
    expect(classifyConnectivityFailure('column customer_age changed type', 'DataHub')).toBeUndefined()
  })
})
