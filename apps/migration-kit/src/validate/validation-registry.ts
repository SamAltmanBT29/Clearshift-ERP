import { ValidationRule, ValidationPhase } from './types.js';
import {
  createRequiredFieldRule,
  createFormatRule,
  createEnumRule,
  createRelationshipRule,
  createDomainRule,
} from './validators.js';

export class ValidationRegistry {
  private rules: Map<string, ValidationRule> = new Map();

  constructor() {
    this.registerDefaultV1Rules();
  }

  /**
   * Registers a single validation rule
   */
  public registerRule(rule: ValidationRule): void {
    this.rules.set(rule.ruleId, rule);
  }

  /**
   * Registers multiple validation rules
   */
  public registerRules(rules: ValidationRule[]): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  /**
   * Retrieves registered rules matching module, entity, and phase filters
   */
  public getRules(filter: {
    module: string;
    entity?: string;
    phase?: ValidationPhase;
  }): ValidationRule[] {
    return Array.from(this.rules.values()).filter((rule) => {
      if (rule.module !== filter.module) {
        return false;
      }
      if (filter.entity && rule.entity !== filter.entity) {
        return false;
      }
      if (filter.phase && rule.phase !== filter.phase) {
        return false;
      }
      return true;
    });
  }

  /**
   * Retrieves all rules
   */
  public getAllRules(): ValidationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Clears all registered rules (useful in tests)
   */
  public clear(): void {
    this.rules.clear();
  }

  /**
   * Resets registry to default V1 module rules
   */
  public resetToDefaults(): void {
    this.clear();
    this.registerDefaultV1Rules();
  }

  /**
   * Registers baseline V1 rules for ClearShift CRM modules
   */
  private registerDefaultV1Rules(): void {
    // -------------------------------------------------------------
    // CRM-1: Contacts & Companies
    // -------------------------------------------------------------
    this.registerRules([
      createRequiredFieldRule({
        ruleId: 'CRM1-VAL-REQ-01',
        module: 'crm-1',
        entity: 'contacts',
        field: 'first_name',
        phase: 'pre_load',
        description: 'Contact must have a non-empty first_name.',
      }),
      createRequiredFieldRule({
        ruleId: 'CRM1-VAL-REQ-02',
        module: 'crm-1',
        entity: 'contacts',
        field: 'last_name',
        phase: 'pre_load',
        description: 'Contact must have a non-empty last_name.',
      }),
      createRequiredFieldRule({
        ruleId: 'CRM1-VAL-REQ-03',
        module: 'crm-1',
        entity: 'contacts',
        field: 'golden_id',
        phase: 'pre_load',
        description: 'Contact must possess a non-empty golden_id identity.',
      }),
      createFormatRule({
        ruleId: 'CRM1-VAL-FMT-01',
        module: 'crm-1',
        entity: 'contacts',
        field: 'email',
        format: 'email',
        phase: 'pre_load',
        description: 'Contact email must conform to valid RFC email format.',
      }),
      createFormatRule({
        ruleId: 'CRM1-VAL-FMT-02',
        module: 'crm-1',
        entity: 'contacts',
        field: 'phone',
        format: 'phone',
        phase: 'pre_load',
        description: 'Contact phone must conform to standard phone format.',
      }),
      createEnumRule({
        ruleId: 'CRM1-VAL-ENUM-01',
        module: 'crm-1',
        entity: 'contacts',
        field: 'lead_status',
        allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
        phase: 'pre_load',
        description: 'Contact lead_status must be New, Working, Qualified, or Closed.',
      }),
      createEnumRule({
        ruleId: 'CRM1-VAL-ENUM-02',
        module: 'crm-1',
        entity: 'contacts',
        field: 'consent_status',
        allowedValues: ['unknown', 'granted', 'withdrawn'],
        phase: 'pre_load',
        description: 'Contact consent_status must be unknown, granted, or withdrawn.',
      }),
      // Post-Load Link Integrity Check: contact.company_id references crm1_companies
      createRelationshipRule({
        ruleId: 'CRM1-VAL-REL-01',
        module: 'crm-1',
        sourceEntity: 'contacts',
        foreignKeyField: 'company_id',
        targetEntity: 'companies',
        phase: 'post_load',
        description: 'Contact company_id must reference an existing company in target database.',
      }),
      // Domain Rule: Consent timestamp check
      createDomainRule({
        ruleId: 'CRM1-VAL-DOM-01',
        module: 'crm-1',
        entity: 'contacts',
        name: 'Consent Freshness & Timestamp Rule',
        description: 'When consent_status is granted or withdrawn, consent_updated_at must be populated.',
        phase: 'pre_load',
        validator: (ctx) => {
          const status = ctx.record?.consent_status;
          const ts = ctx.record?.consent_updated_at;
          if (status && status !== 'unknown' && !ts) {
            return {
              valid: false,
              reasonCode: 'DOMAIN_RULE_VIOLATION',
              message: `Consent status '${status}' requires a valid consent_updated_at timestamp.`,
              field: 'consent_updated_at',
            };
          }
          return { valid: true };
        },
      }),

      // Companies rules
      createRequiredFieldRule({
        ruleId: 'CRM1-VAL-REQ-10',
        module: 'crm-1',
        entity: 'companies',
        field: 'name',
        phase: 'pre_load',
        description: 'Company name is mandatory.',
      }),
      createFormatRule({
        ruleId: 'CRM1-VAL-FMT-10',
        module: 'crm-1',
        entity: 'companies',
        field: 'email',
        format: 'email',
        phase: 'pre_load',
      }),
    ]);

    // -------------------------------------------------------------
    // CRM-2: Deals & Quotes
    // -------------------------------------------------------------
    this.registerRules([
      createRequiredFieldRule({
        ruleId: 'CRM2-VAL-REQ-01',
        module: 'crm-2',
        entity: 'deals',
        field: 'title',
        phase: 'pre_load',
      }),
      createRelationshipRule({
        ruleId: 'CRM2-VAL-REL-01',
        module: 'crm-2',
        sourceEntity: 'deals',
        foreignKeyField: 'contact_id',
        targetEntity: 'contacts',
        phase: 'post_load',
        description: 'Deal contact_id must reference an existing contact.',
      }),
    ]);

    // -------------------------------------------------------------
    // CRM-3: Support Tickets
    // -------------------------------------------------------------
    this.registerRules([
      createRequiredFieldRule({
        ruleId: 'CRM3-VAL-REQ-01',
        module: 'crm-3',
        entity: 'tickets',
        field: 'subject',
        phase: 'pre_load',
      }),
      createRelationshipRule({
        ruleId: 'CRM3-VAL-REL-01',
        module: 'crm-3',
        sourceEntity: 'tickets',
        foreignKeyField: 'contact_id',
        targetEntity: 'contacts',
        phase: 'post_load',
        description: 'Ticket contact_id must reference an existing contact.',
      }),
    ]);

    // -------------------------------------------------------------
    // CRM-4: Campaigns & Lists
    // -------------------------------------------------------------
    this.registerRules([
      createRequiredFieldRule({
        ruleId: 'CRM4-VAL-REQ-01',
        module: 'crm-4',
        entity: 'campaigns',
        field: 'name',
        phase: 'pre_load',
      }),
    ]);

    // -------------------------------------------------------------
    // CRM-5: Ingestion Batches & Analytics
    // -------------------------------------------------------------
    this.registerRules([
      createRequiredFieldRule({
        ruleId: 'CRM5-VAL-REQ-01',
        module: 'crm-5',
        entity: 'batch_runs',
        field: 'module',
        phase: 'pre_load',
      }),
    ]);
  }
}

/**
 * Singleton instance of the default validation registry
 */
export const validationRegistry = new ValidationRegistry();
