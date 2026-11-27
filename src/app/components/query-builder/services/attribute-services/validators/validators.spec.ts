import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { NodeAttribute } from '../../../models/node-attribute';
import { QueryNode } from '../../../models/query-node';
import { QueryNodeTree } from '../../../models/query-node-tree';
import { QueryNodeData } from '../../../models/constants/query-node-data';
import { ValidationResult } from '../../validation.service';
import { AttributeAliasValueValidatorService } from './attributes/attribute-alias-value-validator.service';
import { AttributeTypeNumberValidatorService } from './attributes/parser/attribute-type-number-validator.service';
import { TypeBooleanValidatorService } from './attributes/parser/type-boolean-validator.service';
import { AttributeAggregateFunctionNameValidatorService } from './attributes/parser/attribute-aggregate-function-name-validator.service';
import { AttributeDateGroupingNameValidatorService } from './attributes/parser/attribute-dategrouping-name-validator.service';
import { EntityNodeRequiredNameValidatorService } from './nodes/entity-node-required-name-validator.service';
import { RequiredNodeValidatorService } from './tree/required-node-validator.service';

// These validators only read `value$` / `attributes$` / `root`, so light stubs are enough.
function attributeWithValue(value: string): NodeAttribute {
  return { value$: new BehaviorSubject<string>(value) } as unknown as NodeAttribute;
}

function nodeWithAttributes(editorNames: string[]): QueryNode {
  const attributes = editorNames.map(editorName => ({ editorName }) as NodeAttribute);
  return { attributes$: new BehaviorSubject<NodeAttribute[]>(attributes) } as unknown as QueryNode;
}

function treeOf(...nodeNames: string[]): BehaviorSubject<QueryNodeTree> {
  const tree = new QueryNodeTree();
  let previous: QueryNode = null;
  for (const nodeName of nodeNames) {
    const node = { nodeName, next: null } as QueryNode;
    if (previous) {
      previous.next = node;
    } else {
      tree.root = node;
    }
    previous = node;
  }
  return new BehaviorSubject<QueryNodeTree>(tree);
}

function validateValue(validator: { validate(attribute: NodeAttribute): any }, value: string): Promise<ValidationResult> {
  return firstValueFrom(validator.validate(attributeWithValue(value)));
}

describe('Attribute validators', () => {
  describe('AttributeAliasValueValidatorService', () => {
    const validator = new AttributeAliasValueValidatorService();

    it('accepts an empty value and a regular alias', async () => {
      expect((await validateValue(validator, '')).isValid).toBeTrue();
      expect((await validateValue(validator, 'acc_1')).isValid).toBeTrue();
    });

    it('rejects an alias that starts with a digit or contains whitespace', async () => {
      const startsWithDigit = await validateValue(validator, '1acc');
      expect(startsWithDigit.isValid).toBeFalse();
      expect(startsWithDigit.errors.length).toBe(1);
      expect((await validateValue(validator, 'my alias')).isValid).toBeFalse();
    });
  });

  describe('AttributeTypeNumberValidatorService', () => {
    const validator = new AttributeTypeNumberValidatorService();

    it('accepts numbers and an empty value', async () => {
      expect((await validateValue(validator, '10')).isValid).toBeTrue();
      expect((await validateValue(validator, ' 5 ')).isValid).toBeTrue();
      expect((await validateValue(validator, '')).isValid).toBeTrue();
    });

    it('rejects non-numeric text', async () => {
      const result = await validateValue(validator, 'ten');
      expect(result.isValid).toBeFalse();
      expect(result.errors).toEqual(['The value must be a number.']);
    });
  });

  describe('TypeBooleanValidatorService', () => {
    const validator = new TypeBooleanValidatorService();

    it('accepts true/false in any case and an empty value', async () => {
      expect((await validateValue(validator, 'true')).isValid).toBeTrue();
      expect((await validateValue(validator, 'FALSE')).isValid).toBeTrue();
      expect((await validateValue(validator, '')).isValid).toBeTrue();
    });

    it('rejects anything else', async () => {
      expect((await validateValue(validator, '1')).isValid).toBeFalse();
      expect((await validateValue(validator, 'yes')).isValid).toBeFalse();
    });
  });

  describe('AttributeAggregateFunctionNameValidatorService', () => {
    const validator = new AttributeAggregateFunctionNameValidatorService();

    it('accepts known aggregate functions', async () => {
      for (const name of ['avg', 'count', 'countcolumn', 'max', 'min', 'sum']) {
        expect((await validateValue(validator, name)).isValid).withContext(name).toBeTrue();
      }
    });

    it('rejects an unknown function with a message naming it', async () => {
      const result = await validateValue(validator, 'median');
      expect(result.isValid).toBeFalse();
      expect(result.errors[0]).toContain('median');
    });
  });

  describe('AttributeDateGroupingNameValidatorService', () => {
    const validator = new AttributeDateGroupingNameValidatorService();

    it('accepts known date groupings and rejects unknown ones', async () => {
      expect((await validateValue(validator, 'fiscal-year')).isValid).toBeTrue();
      expect((await validateValue(validator, 'decade')).isValid).toBeFalse();
    });
  });
});

describe('Node validators', () => {
  describe('EntityNodeRequiredNameValidatorService', () => {
    const validator = new EntityNodeRequiredNameValidatorService();

    it('is valid when the entity node has a name attribute', async () => {
      const result = await firstValueFrom(validator.validate(nodeWithAttributes(['name', 'alias'])));
      expect(result.isValid).toBeTrue();
    });

    it('is invalid without a name attribute', async () => {
      const result = await firstValueFrom(validator.validate(nodeWithAttributes(['alias'])));
      expect(result.isValid).toBeFalse();
      expect(result.errors).toEqual(['Entity name is required.']);
    });
  });
});

describe('Tree validators', () => {
  describe('RequiredNodeValidatorService', () => {
    const validator = new RequiredNodeValidatorService();

    it('is valid for fetch followed by entity', async () => {
      const result = await firstValueFrom(validator.validate(treeOf(QueryNodeData.Fetch.NodeName, QueryNodeData.Entity.NodeName)));
      expect(result.isValid).toBeTrue();
    });

    it('requires a fetch root', async () => {
      const result = await firstValueFrom(validator.validate(treeOf(QueryNodeData.Entity.NodeName)));
      expect(result.errors).toEqual(['Root node is required']);
    });

    it('requires an entity right after the root', async () => {
      expect((await firstValueFrom(validator.validate(treeOf(QueryNodeData.Fetch.NodeName)))).errors)
        .toEqual(['Entity node is required']);
      expect((await firstValueFrom(validator.validate(treeOf(QueryNodeData.Fetch.NodeName, QueryNodeData.Filter.NodeName)))).errors)
        .toEqual(['Entity node is required']);
    });
  });
});
