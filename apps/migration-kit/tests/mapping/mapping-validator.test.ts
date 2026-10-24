import { describe, it, expect } from 'vitest';
import { MappingValidator } from '../../src/mapping/mapping-validator.js';
import { MissingRequiredTargetMappingError } from '../../src/mapping/types.js';
import {
  type MappingTemplate,
  CRM_CONTACTS_TARGET_FIELDS,
  CRM_LEADS_TARGET_FIELDS,
} from '@clearshift/contracts';

describe('KIT-05: Mapping Validator & Required Target Field Enforcement', () => {
  const validTemplate: MappingTemplate = {
    id: 't1000000-0000-4000-8000-000000000001',
    module: 'crm',
    name: 'Standard CRM Contacts',
    version: '1.0.0',
    targetEntity: 'contacts',
    fieldMappings: [
      { sourceColumn: 'first_name', targetField: 'firstName', required: true },
      { sourceColumn: 'last_name', targetField: 'lastName', required: true },
      { sourceColumn: 'email', targetField: 'email', required: true },
      { sourceColumn: 'phone', targetField: 'phone', required: false },
    ],
    valueConversions: [],
    createdBy: 'system',
  };

  it('passes validation when all required target fields are mapped', () => {
    const res = MappingValidator.validate(validTemplate, CRM_CONTACTS_TARGET_FIELDS);
    expect(res.valid).toBe(true);
    expect(res.missingRequiredFields.length).toBe(0);
    expect(res.errors.length).toBe(0);
  });

  it('fails validation when a required target field is absent, returning field and template identifiers', () => {
    // Missing 'email' and 'lastName'
    const incompleteTemplate: MappingTemplate = {
      id: 't2000000-0000-4000-8000-000000000002',
      module: 'crm',
      name: 'Incomplete Contacts Template',
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: [
        { sourceColumn: 'first_name', targetField: 'firstName', required: true },
      ],
      valueConversions: [],
      createdBy: 'system',
    };

    const res = MappingValidator.validate(incompleteTemplate, CRM_CONTACTS_TARGET_FIELDS);
    expect(res.valid).toBe(false);
    expect(res.missingRequiredFields).toContain('lastName');
    expect(res.missingRequiredFields).toContain('email');

    // Asserts exact template name, ID and field identifier present in error text
    const emailError = res.errors.find((e) => e.includes('email'));
    expect(emailError).toBeDefined();
    expect(emailError).toContain("Required target field 'email'");
    expect(emailError).toContain("template 'Incomplete Contacts Template'");
    expect(emailError).toContain('t2000000-0000-4000-8000-000000000002');
  });

  it('throws MissingRequiredTargetMappingError with identifiers on assertValid', () => {
    const incompleteTemplate: MappingTemplate = {
      id: 't3000000-0000-4000-8000-000000000003',
      module: 'crm-1',
      name: 'Strict Validation Template',
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: [
        { sourceColumn: 'first_name', targetField: 'firstName', required: true },
      ],
      valueConversions: [],
      createdBy: 'system',
    };

    expect(() =>
      MappingValidator.assertValid(incompleteTemplate, CRM_CONTACTS_TARGET_FIELDS)
    ).toThrow(MissingRequiredTargetMappingError);

    try {
      MappingValidator.assertValid(incompleteTemplate, CRM_CONTACTS_TARGET_FIELDS);
    } catch (err: any) {
      expect(err.code).toBe('MISSING_REQUIRED_MAPPING');
      expect(err.missingFields).toContain('lastName');
      expect(err.missingFields).toContain('email');
      expect(err.templateName).toBe('Strict Validation Template');
      expect(err.templateId).toBe('t3000000-0000-4000-8000-000000000003');
      expect(err.message).toContain("template 'Strict Validation Template'");
    }
  });

  it('detects and flags invalid enum conversions against target field allowed values', () => {
    const invalidEnumTemplate: MappingTemplate = {
      id: 't4000000-0000-4000-8000-000000000004',
      module: 'crm',
      name: 'Enum Test Template',
      version: '1.0.0',
      targetEntity: 'leads',
      fieldMappings: [
        { sourceColumn: 'first_name', targetField: 'firstName', required: true },
        { sourceColumn: 'last_name', targetField: 'lastName', required: true },
        { sourceColumn: 'email', targetField: 'email', required: true },
        { sourceColumn: 'status_col', targetField: 'leadStatus', required: true },
      ],
      valueConversions: [
        {
          targetField: 'leadStatus',
          mappings: {
            DISQUALIFIED: 'BogusStatus', // 'BogusStatus' is not in ['New', 'Working', 'Qualified', 'Closed']
          },
          unmappedAction: 'reject',
        },
      ],
      createdBy: 'system',
    };

    const res = MappingValidator.validate(invalidEnumTemplate, CRM_LEADS_TARGET_FIELDS);
    expect(res.valid).toBe(false);
    expect(res.invalidEnumConversions.length).toBe(1);
    expect(res.invalidEnumConversions[0].field).toBe('leadStatus');
    expect(res.invalidEnumConversions[0].reason).toContain("'BogusStatus' is not in allowed values");
  });

  it('detects source column not found in supplied file headers', () => {
    const res = MappingValidator.validate(
      validTemplate,
      CRM_CONTACTS_TARGET_FIELDS,
      ['first_name', 'email'] // 'last_name' and 'phone' missing from file
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Mapped source column 'last_name' does not exist"))).toBe(true);
  });
});
