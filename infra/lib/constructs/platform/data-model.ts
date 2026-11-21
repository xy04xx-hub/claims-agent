// Owner: B (muzair110)
// Single source of DynamoDB key and index attribute names for the five tables.
// Mirrors contracts/data-model.md. Every attribute is a string.

export const KEY_ATTR = { pk: 'pk', sk: 'sk' } as const;

export const GSI_ATTR = {
  gsi1: { pk: 'gsi1pk', sk: 'gsi1sk' },
  gsi2: { pk: 'gsi2pk', sk: 'gsi2sk' },
  gsi3: { pk: 'gsi3pk' },
} as const;

export interface IndexSpec {
  name: string;
  pk: string;
  sk?: string;
}

export interface TableSpec {
  id: 'Policies' | 'Claims' | 'EvidenceIndex' | 'ClaimTypePacks' | 'AuditLog';
  indexes: IndexSpec[];
}

export const TABLE_SPECS: readonly TableSpec[] = [
  {
    id: 'Policies',
    indexes: [{ name: 'byCustomer', pk: GSI_ATTR.gsi1.pk, sk: GSI_ATTR.gsi1.sk }],
  },
  {
    id: 'Claims',
    indexes: [
      { name: 'byCustomer', pk: GSI_ATTR.gsi1.pk, sk: GSI_ATTR.gsi1.sk },
      // Sparse: only routed claims carry gsi2pk/gsi2sk.
      { name: 'byQueue', pk: GSI_ATTR.gsi2.pk, sk: GSI_ATTR.gsi2.sk },
      { name: 'byRequest', pk: GSI_ATTR.gsi3.pk },
    ],
  },
  {
    id: 'EvidenceIndex',
    indexes: [{ name: 'byEvidence', pk: GSI_ATTR.gsi1.pk, sk: GSI_ATTR.gsi1.sk }],
  },
  { id: 'ClaimTypePacks', indexes: [] },
  { id: 'AuditLog', indexes: [] },
];
