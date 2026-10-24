import { describe, it, expect } from 'vitest';
import {
  InMemoryMappingTemplateRepository,
  assertTemplateEditorPermission,
  DEFAULT_CRM_CONTACTS_TEMPLATE,
} from '../../src/mapping/template-registry.js';
import { UnauthorizedTemplateEditError } from '../../src/mapping/types.js';
import type { MappingTemplate } from '@clearshift/contracts';

describe('KIT-05: Mapping Template Registry & Access Control', () => {
  it('pre-seeds default CRM contacts template', async () => {
    const repo = new InMemoryMappingTemplateRepository(true);
    const tpl = await repo.getTemplateById(DEFAULT_CRM_CONTACTS_TEMPLATE.id!);

    expect(tpl).not.toBeNull();
    expect(tpl!.name).toBe('CRM Contacts Standard Template');
    expect(tpl!.module).toBe('crm');
    expect(tpl!.targetEntity).toBe('contacts');
    expect(tpl!.fieldMappings.length).toBe(6);
  });

  it('guarantees exact round-trip fidelity when saving and loading templates', async () => {
    const repo = new InMemoryMappingTemplateRepository(false);

    const customTemplate: MappingTemplate = {
      id: 'a1000000-0000-4000-8000-000000000001',
      module: 'crm-1',
      name: 'Custom Partner Contacts Template',
      version: '1.2.0',
      targetEntity: 'contacts',
      fieldMappings: [
        { sourceColumn: 'src_fname', targetField: 'firstName', required: true, transformation: 'trim' },
        { sourceColumn: 'src_lname', targetField: 'lastName', required: true, transformation: 'trim' },
        { sourceColumn: 'src_mail', targetField: 'email', required: true, transformation: 'lowercase' },
        { sourceColumn: 'src_cell', targetField: 'phone', required: false, transformation: 'identity' },
      ],
      valueConversions: [
        {
          targetField: 'leadStatus',
          mappings: { OPEN: 'New', CLOSED: 'Closed' },
          unmappedAction: 'reject',
        },
      ],
      createdBy: 'partner_engineer',
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    };

    const saved = await repo.saveTemplate(customTemplate);
    expect(saved.id).toBe(customTemplate.id);

    const loaded = await repo.getTemplateById(customTemplate.id!);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe(customTemplate.name);
    expect(loaded!.version).toBe(customTemplate.version);
    expect(loaded!.module).toBe(customTemplate.module);
    expect(loaded!.fieldMappings).toEqual(customTemplate.fieldMappings);
    expect(loaded!.valueConversions).toEqual(customTemplate.valueConversions);
    expect(loaded!.createdBy).toBe(customTemplate.createdBy);
  });

  it('filters templates by module scope', async () => {
    const repo = new InMemoryMappingTemplateRepository(false);

    await repo.saveTemplate({
      id: 'b1000000-0000-4000-8000-000000000001',
      module: 'crm',
      name: 'CRM Template 1',
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: [{ sourceColumn: 'c1', targetField: 'firstName', required: true }],
      valueConversions: [],
      createdBy: 'admin',
    });

    await repo.saveTemplate({
      id: 'b2000000-0000-4000-8000-000000000002',
      module: 'erp',
      name: 'ERP Template 1',
      version: '1.0.0',
      targetEntity: 'items',
      fieldMappings: [{ sourceColumn: 'sku_code', targetField: 'sku', required: true }],
      valueConversions: [],
      createdBy: 'admin',
    });

    const crmList = await repo.listTemplates('crm');
    expect(crmList.length).toBe(1);
    expect(crmList[0].name).toBe('CRM Template 1');

    const erpList = await repo.listTemplates('erp');
    expect(erpList.length).toBe(1);
    expect(erpList[0].name).toBe('ERP Template 1');

    const allList = await repo.listTemplates();
    expect(allList.length).toBe(2);
  });

  it('enforces authorized editor permissions per module scope', () => {
    // Authorized global roles
    expect(() => assertTemplateEditorPermission('alice', 'migration_admin', 'crm')).not.toThrow();
    expect(() => assertTemplateEditorPermission('bob', 'platform_admin', 'erp')).not.toThrow();

    // Module-specific authorized roles
    expect(() => assertTemplateEditorPermission('charlie', 'crm_admin', 'crm')).not.toThrow();
    expect(() => assertTemplateEditorPermission('charlie', 'crm_integration', 'crm-1')).not.toThrow();
    expect(() => assertTemplateEditorPermission('david', 'erp_admin', 'erp-1')).not.toThrow();

    // Unauthorized roles
    expect(() => assertTemplateEditorPermission('eve', 'viewer', 'crm')).toThrow(UnauthorizedTemplateEditError);
    expect(() => assertTemplateEditorPermission('eve', 'sales_rep', 'crm')).toThrow(UnauthorizedTemplateEditError);

    // Cross-module unauthorized modification
    expect(() => assertTemplateEditorPermission('frank', 'erp_admin', 'crm')).toThrow(UnauthorizedTemplateEditError);
    expect(() => assertTemplateEditorPermission('grace', 'crm_admin', 'erp')).toThrow(UnauthorizedTemplateEditError);
  });
});
