import { describe, expect, it } from 'vitest'
import { defaultQueryCheckRule, parseQueryCheckRule, queryCheckRuleError } from './query-check'

describe('Query Check contract', () => {
  it('accepts a registered bounded aggregate profile read', () => {
    expect(parseQueryCheckRule(defaultQueryCheckRule)).toMatchObject({
      complete: true,
      connector: 'datahub',
      protocol: 'graphql',
      operation: 'profile.read',
      mode: 'read_only',
      variables: 'host_validated',
      response: 'bounded_aggregate_profile',
    })
    expect(queryCheckRuleError(defaultQueryCheckRule)).toBeUndefined()
  })

  it('accepts registered metadata reads without exposing values', () => {
    const rule = defaultQueryCheckRule
      .replace('profile.read', 'entity.read')
      .replace('bounded_aggregate_profile', 'bounded_metadata')
    expect(queryCheckRuleError(rule)).toBeUndefined()
  })

  it('accepts a governed write only with every safety boundary', () => {
    const rule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=metadata.update | mode=governed_write | variables=host_validated | timeout_ms=8000 | review=required | dry_run=required | rollback=versioned | response=mutation_receipt'
    expect(queryCheckRuleError(rule)).toBeUndefined()
  })

  it.each([
    ['arbitrary operation', defaultQueryCheckRule.replace('profile.read', 'graphql.execute'), 'Choose one registered operation'],
    ['raw variables', defaultQueryCheckRule.replace('host_validated', 'raw'), 'validated by the SAM LAB host'],
    ['unbounded timeout', defaultQueryCheckRule.replace('timeout_ms=8000', 'timeout_ms=60000'), 'between 1000 and 30000'],
    ['write without review', defaultQueryCheckRule.replace('profile.read', 'metadata.update'), 'mode=governed_write'],
    ['aggregate read with metadata response', defaultQueryCheckRule.replace('bounded_aggregate_profile', 'bounded_metadata'), 'bounded aggregate profile'],
    ['free introspection', `${defaultQueryCheckRule} | selection=__schema`, 'introspection'],
  ])('rejects %s', (_label, rule, message) => {
    expect(queryCheckRuleError(rule)).toContain(message)
  })
})
