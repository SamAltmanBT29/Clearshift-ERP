/**
 * Migration Kit Target Schema Metadata & Type Compatibility Tests (KIT-14 / ERP1-22)
 *
 * Tests:
 * - Module metadata registry registration, retrieval, and error handling.
 * - Type compatibility engine for all target types (decimal, boolean, date, enum, uuid, string).
 * - Field mapping validator enforcing required fields and reporting type warnings.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MigrationKitRegistry,
  migrationKitRegistry,
  registerModuleKitMetadata,
  getModuleKitMetadata,
  checkTypeCompatibility,
  validateFieldMapping,
  type ModuleKitMetadata,
  type TargetEntityMetadata,
} from '../src/domain/metadata.js';

describe('MigrationKitRegistry', () => {
  let registry: MigrationKitRegistry;

  const mockEntity: TargetEntityMetadata = {
    entity: 'test_items',
    label: 'Test Items',
    module: 'test_mod',
    schemaVersion: 1,
    targetTable: 'test_items_table',
    primaryKey: 'id',
    naturalKey: 'code',
    fields: [
      { name: 'code', label: 'Item Code', type: 'string', required: true },
      { name: 'amount', label: 'Amount', type: 'decimal', required: true },
      { name: 'status', label: 'Status', type: 'enum', required: false, enumOptions: ['active', 'inactive'] },
    ],
    mappingDefaults: { code: 'legacy_code', amount: 'legacy_amount' },
  };

  const mockModuleMetadata: ModuleKitMetadata = {
    moduleId: 'test_mod',
    moduleName: 'Test Business Module',
    defaultEntity: 'test_items',
    entities: {
      test_items: mockEntity,
    },
    supportedSourceTypes: ['csv', 'json'],
  };

  beforeEach(() => {
    registry = new MigrationKitRegistry();
  });

  it('registers and retrieves module metadata successfully', () => {
    registry.register(mockModuleMetadata);
    const retrieved = registry.get('test_mod');
    expect(retrieved).toBeDefined();
    expect(retrieved?.moduleId).toBe('test_mod');
    expect(retrieved?.moduleName).toBe('Test Business Module');
    expect(retrieved?.entities['test_items']?.primaryKey).toBe('id');
  });

  it('retrieves specific target entity metadata', () => {
    registry.register(mockModuleMetadata);
    const entity = registry.getEntity('test_mod', 'test_items');
    expect(entity).toBeDefined();
    expect(entity?.entity).toBe('test_items');
    expect(entity?.fields).toHaveLength(3);
  });

  it('returns undefined for unregistered module or entity', () => {
    expect(registry.get('unknown_mod')).toBeUndefined();
    expect(registry.getEntity('unknown_mod', 'test_items')).toBeUndefined();
  });

  it('throws an error if moduleId is empty', () => {
    expect(() => {
      registry.register({ ...mockModuleMetadata, moduleId: '' });
    }).toThrow(/must specify a non-empty moduleId/);
  });

  it('lists all registered modules', () => {
    registry.register(mockModuleMetadata);
    const all = registry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.moduleId).toBe('test_mod');
  });

  it('clears all registered modules', () => {
    registry.register(mockModuleMetadata);
    registry.clear();
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.get('test_mod')).toBeUndefined();
  });

  it('works with the exported singleton and helper functions', () => {
    migrationKitRegistry.clear();
    registerModuleKitMetadata(mockModuleMetadata);
    expect(getModuleKitMetadata('test_mod')).toBeDefined();
    expect(migrationKitRegistry.getEntity('test_mod', 'test_items')).toBeDefined();
  });
});

describe('checkTypeCompatibility', () => {
  describe('targetType: decimal / number', () => {
    it('approves compatible numeric source types without warnings', () => {
      expect(checkTypeCompatibility('number', 'decimal')).toEqual({ compatible: true });
      expect(checkTypeCompatibility('integer', 'decimal')).toEqual({ compatible: true });
      expect(checkTypeCompatibility('float', 'decimal')).toEqual({ compatible: true });
      expect(checkTypeCompatibility('decimal', 'decimal')).toEqual({ compatible: true });
    });

    it('returns warning for string/text source type', () => {
      const res = checkTypeCompatibility('string', 'decimal');
      expect(res.compatible).toBe(true);
      expect(res.warning).toMatch(/Text column will be parsed into numeric decimal/);
    });

    it('returns incompatible error for date, boolean, and uuid types', () => {
      const dateRes = checkTypeCompatibility('date', 'decimal');
      expect(dateRes.compatible).toBe(false);
      expect(dateRes.error).toBe('Cannot convert date to decimal');
      expect(dateRes.warning).toMatch(/Incompatible type/);

      const boolRes = checkTypeCompatibility('boolean', 'number');
      expect(boolRes.compatible).toBe(false);

      const uuidRes = checkTypeCompatibility('uuid', 'decimal');
      expect(uuidRes.compatible).toBe(false);
    });
  });

  describe('targetType: boolean', () => {
    it('approves boolean source types without warnings', () => {
      expect(checkTypeCompatibility('boolean', 'boolean')).toEqual({ compatible: true });
      expect(checkTypeCompatibility('bool', 'boolean')).toEqual({ compatible: true });
    });

    it('returns warning for string/number coersion', () => {
      const res = checkTypeCompatibility('string', 'boolean');
      expect(res.compatible).toBe(true);
      expect(res.warning).toMatch(/will be coerced to boolean/);
    });

    it('returns incompatible error for date', () => {
      const res = checkTypeCompatibility('date', 'boolean');
      expect(res.compatible).toBe(false);
      expect(res.error).toBe('Cannot convert date to boolean');
    });
  });

  describe('targetType: date', () => {
    it('approves date/datetime/timestamp without warnings', () => {
      expect(checkTypeCompatibility('date', 'date')).toEqual({ compatible: true });
      expect(checkTypeCompatibility('datetime', 'date')).toEqual({ compatible: true });
      expect(checkTypeCompatibility('timestamp', 'date')).toEqual({ compatible: true });
    });

    it('returns warning for string format', () => {
      const res = checkTypeCompatibility('string', 'date');
      expect(res.compatible).toBe(true);
      expect(res.warning).toMatch(/must follow ISO-8601/);
    });

    it('returns incompatible error for number and boolean', () => {
      expect(checkTypeCompatibility('number', 'date').compatible).toBe(false);
      expect(checkTypeCompatibility('boolean', 'date').compatible).toBe(false);
    });
  });

  describe('targetType: enum', () => {
    const enumOpts = ['pcs', 'kg', 'g', 'litre', 'metre', 'box'];

    it('returns warning with allowed options for string source type', () => {
      const res = checkTypeCompatibility('string', 'enum', enumOpts);
      expect(res.compatible).toBe(true);
      expect(res.warning).toMatch(/Values must strictly match one of the allowed options: \[pcs, kg, g, litre, metre, box\]/);
    });

    it('returns incompatible error for number, date, boolean, uuid', () => {
      const res = checkTypeCompatibility('number', 'enum', enumOpts);
      expect(res.compatible).toBe(false);
      expect(res.error).toBe('Cannot convert number to enum');
      expect(res.warning).toMatch(/Incompatible type/);
    });
  });

  describe('targetType: uuid', () => {
    it('approves uuid without warnings', () => {
      expect(checkTypeCompatibility('uuid', 'uuid')).toEqual({ compatible: true });
    });

    it('returns warning for string UUID format', () => {
      const res = checkTypeCompatibility('string', 'uuid');
      expect(res.compatible).toBe(true);
      expect(res.warning).toMatch(/must be a valid RFC 4122 UUID/);
    });

    it('returns incompatible error for number, date, boolean', () => {
      expect(checkTypeCompatibility('number', 'uuid').compatible).toBe(false);
      expect(checkTypeCompatibility('date', 'uuid').compatible).toBe(false);
    });
  });

  describe('targetType: string', () => {
    it('is compatible with all source types via stringification', () => {
      expect(checkTypeCompatibility('string', 'string').compatible).toBe(true);
      expect(checkTypeCompatibility('number', 'string').compatible).toBe(true);
      expect(checkTypeCompatibility('date', 'string').compatible).toBe(true);
      expect(checkTypeCompatibility('boolean', 'string').compatible).toBe(true);
    });
  });
});

describe('validateFieldMapping', () => {
  const testEntity: TargetEntityMetadata = {
    entity: 'products',
    label: 'Products',
    module: 'erp1',
    schemaVersion: 1,
    targetTable: 'erp1_products',
    primaryKey: 'id',
    fields: [
      { name: 'name', label: 'Product Name', type: 'string', required: true },
      { name: 'sku', label: 'SKU', type: 'string', required: true },
      { name: 'price', label: 'Price', type: 'decimal', required: true },
      { name: 'unitOfMeasure', label: 'UOM', type: 'enum', required: true, enumOptions: ['pcs', 'kg'] },
      { name: 'taxRate', label: 'Tax Rate', type: 'decimal', required: false },
    ],
  };

  it('fails validation when required target fields are unmapped', () => {
    const mapping = {
      name: 'col_name',
      // sku, price, unitOfMeasure missing
    };
    const result = validateFieldMapping(testEntity, mapping);
    expect(result.valid).toBe(false);
    expect(result.missingRequiredFields).toContain('SKU');
    expect(result.missingRequiredFields).toContain('Price');
    expect(result.missingRequiredFields).toContain('UOM');
    expect(result.missingRequiredFields).not.toContain('Product Name');
    expect(result.missingRequiredFields).not.toContain('Tax Rate');
  });

  it('detects incompatible source types and produces errors and warnings', () => {
    const mapping = {
      name: 'col_name',
      sku: 'col_sku',
      price: 'col_date', // Incompatible date -> decimal
      unitOfMeasure: 'col_bool', // Incompatible boolean -> enum
    };
    const sourceTypes = {
      col_name: 'string',
      col_sku: 'string',
      col_date: 'date',
      col_bool: 'boolean',
    };
    const result = validateFieldMapping(testEntity, mapping, sourceTypes);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.warnings).toHaveLength(2);
    expect(result.errors[0]?.targetField).toBe('price');
    expect(result.errors[1]?.targetField).toBe('unitOfMeasure');
  });

  it('passes validation when all required fields are mapped with compatible types', () => {
    const mapping = {
      name: 'col_name',
      sku: 'col_sku',
      price: 'col_price',
      unitOfMeasure: 'col_uom',
    };
    const sourceTypes = {
      col_name: 'string',
      col_sku: 'string',
      col_price: 'decimal',
      col_uom: 'string',
    };
    const result = validateFieldMapping(testEntity, mapping, sourceTypes);
    expect(result.valid).toBe(true);
    expect(result.missingRequiredFields).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
