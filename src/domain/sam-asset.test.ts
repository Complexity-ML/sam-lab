import { describe, expect, it } from 'vitest'
import { newCard } from './pipeline'
import { isSoftwareAssetCheckpoint, isSoftwareAssetGraph, isSoftwareAssetText } from './sam-asset'

describe('SAM asset qualification', () => {
  it('accepts explicit software evidence and rejects generic commerce products', () => {
    expect(isSoftwareAssetText('Copilot license utilization')).toBe(true)
    expect(isSoftwareAssetCheckpoint({ name: 'software_contracts', urn: 'urn:dbt:software-contracts' })).toBe(true)
    expect(isSoftwareAssetCheckpoint({ name: 'subscription_products', urn: 'urn:dbt:subscription-products' })).toBe(true)
    expect(isSoftwareAssetCheckpoint({ name: 'application_inventory', urn: 'urn:dbt:application-inventory' })).toBe(true)

    expect(isSoftwareAssetCheckpoint({ name: 'product_categories', urn: 'urn:dbt:product-categories' })).toBe(false)
    expect(isSoftwareAssetCheckpoint({ name: 'product_information', urn: 'urn:dbt:product-information' })).toBe(false)
    expect(isSoftwareAssetCheckpoint({ name: 'order_details', urn: 'urn:dbt:order-details' })).toBe(false)
  })

  it('does not let SAM system cards turn an unrelated dataset into a software asset graph', () => {
    const controller = { ...newCard('control', 0), id: 'controller' }
    const explorer = { ...newCard('explorer', 1), id: 'explorer' }
    const source = {
      ...newCard('source', 2),
      id: 'orders',
      data: {
        ...newCard('source', 2).data,
        label: 'order_details',
        description: 'Customer order lines and product categories.',
      },
    }

    expect(isSoftwareAssetGraph([controller, explorer, source])).toBe(false)
  })
})
