// Contract conformance for T-05 (task 4.4): contracts/data-model.md vs TABLE_SPECS vs the synthesized template.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GSI_ATTR, KEY_ATTR, TABLE_SPECS } from '../lib/constructs/platform/data-model.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import type { BaseStackProps } from '../lib/stack-props.js';
import { CI_PLACEHOLDER_ACCOUNT } from '../lib/stage.js';
import { loadStageConfig, resolveRemovalPolicy } from '../lib/stage-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.resolve(HERE, '../../contracts/data-model.md');
const CONFIG_DIR = path.resolve(HERE, '../config');

interface ContractIndex {
  name: string;
  hasSortKey: boolean;
  row: string;
}
interface ContractTable {
  name: string;
  indexes: ContractIndex[];
}

function parseContract(): ContractTable[] {
  const text = fs.readFileSync(CONTRACT, 'utf8');
  const tables: ContractTable[] = [];
  for (const section of text.split(/^## /m).slice(1)) {
    const name = section.split('\n', 1)[0]!.trim();
    if (name === 'Not in DynamoDB') break;
    const indexes: ContractIndex[] = [];
    for (const line of section.split('\n')) {
      const m = /^\|\s*GSI `([^`]+)`\s*\|(.*)\|\s*$/.exec(line);
      if (m) indexes.push({ name: m[1]!, hasSortKey: /\bSK\b/.test(m[2]!), row: line });
    }
    tables.push({ name, indexes });
  }
  return tables;
}

function synth(stage: string): Template {
  const app = new cdk.App();
  const config = loadStageConfig(stage, CONFIG_DIR, () => undefined);
  const props: BaseStackProps = {
    stage,
    config,
    removalPolicy: cdk.RemovalPolicy[resolveRemovalPolicy(stage, config)],
    env: { account: CI_PLACEHOLDER_ACCOUNT, region: 'us-east-1' },
  };
  return Template.fromStack(new FoundationStack(app, 'Foundation', props));
}

type KeySchema = { AttributeName: string; KeyType: 'HASH' | 'RANGE' }[];
interface TableProps {
  KeySchema: KeySchema;
  AttributeDefinitions: { AttributeName: string; AttributeType: string }[];
  GlobalSecondaryIndexes?: { IndexName: string; KeySchema: KeySchema }[];
}

describe('contracts/data-model.md conformance', () => {
  const contract = parseContract();
  const template = synth('dev-a');
  const resources = template.findResources('AWS::DynamoDB::Table');

  it('lists the same tables as TABLE_SPECS', () => {
    const contractNames = contract.map((t) => t.name).sort();
    const specNames = TABLE_SPECS.map((s) => s.id).sort();
    expect(contractNames, 'tables in contract vs TABLE_SPECS').toEqual(specNames);
  });

  it('lists the same indexes per table as TABLE_SPECS', () => {
    for (const t of contract) {
      const spec = TABLE_SPECS.find((s) => s.id === t.name);
      expect(spec, `contract table ${t.name} missing from TABLE_SPECS`).toBeDefined();
      expect(t.indexes.map((i) => i.name).sort(), `indexes of ${t.name}`).toEqual(
        spec!.indexes.map((i) => i.name).sort(),
      );
      for (const i of t.indexes) {
        const si = spec!.indexes.find((x) => x.name === i.name)!;
        expect(si.sk !== undefined, `${t.name}.${i.name} sort key presence`).toBe(i.hasSortKey);
      }
    }
  });

  it('synthesizes exactly the contract tables, keys and indexes', () => {
    const entries = Object.entries(resources);
    expect(entries).toHaveLength(contract.length);
    for (const t of contract) {
      const found = entries.filter(([logicalId]) => logicalId.startsWith(`${t.name}Table`));
      expect(found, `template table for ${t.name}`).toHaveLength(1);
      const props = found[0]![1].Properties as TableProps;
      expect(props.KeySchema, `${t.name} key schema`).toEqual([
        { AttributeName: KEY_ATTR.pk, KeyType: 'HASH' },
        { AttributeName: KEY_ATTR.sk, KeyType: 'RANGE' },
      ]);
      const gsis = props.GlobalSecondaryIndexes ?? [];
      expect(gsis.map((g) => g.IndexName).sort(), `${t.name} index names`).toEqual(
        t.indexes.map((i) => i.name).sort(),
      );
      const spec = TABLE_SPECS.find((s) => s.id === t.name)!;
      for (const g of gsis) {
        const si = spec.indexes.find((x) => x.name === g.IndexName)!;
        const expected: KeySchema = [{ AttributeName: si.pk, KeyType: 'HASH' }];
        if (si.sk) expected.push({ AttributeName: si.sk, KeyType: 'RANGE' });
        expect(g.KeySchema, `${t.name}.${g.IndexName} key schema`).toEqual(expected);
      }
      for (const a of props.AttributeDefinitions) expect(a.AttributeType).toBe('S');
    }
  });

  it('marks byQueue sparse in the contract and defines no default values for gsi2pk', () => {
    const byQueue = contract.find((t) => t.name === 'Claims')!.indexes.find((i) => i.name === 'byQueue');
    expect(byQueue, 'Claims.byQueue in contract').toBeDefined();
    expect(byQueue!.row.toLowerCase()).toContain('sparse');
    const claims = Object.entries(resources).find(([id]) => id.startsWith('ClaimsTable'))![1];
    const props = claims.Properties as TableProps;
    const attr = props.AttributeDefinitions.filter((a) => a.AttributeName === GSI_ATTR.gsi2.pk);
    expect(attr).toEqual([{ AttributeName: 'gsi2pk', AttributeType: 'S' }]);
    expect(JSON.stringify(claims)).not.toMatch(/"Default"|DefaultValue/);
  });
});
