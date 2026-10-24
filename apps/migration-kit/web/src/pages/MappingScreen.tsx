import React, { useState, useId } from 'react';
import type {
  MappingTemplate,
  TargetFieldDefinition,
  FieldMappingDefinition,
  ValueConversionRule,
} from '@clearshift/contracts';

export interface MappingScreenProps {
  batchId?: string | undefined;
  module?: string | undefined;
  sourceColumns?: string[] | undefined;
  sourceColumnTypes?: Record<string, string> | undefined;
  sampleData?: Record<string, string>[] | undefined;
  targetFields?: TargetFieldDefinition[] | undefined;
  templates?: MappingTemplate[] | undefined;
  activeTemplate?: MappingTemplate | null | undefined;
  isLoading?: boolean | undefined;
  isEmpty?: boolean | undefined;
  error?: string | null | undefined;
  onSaveTemplate?: ((template: MappingTemplate) => Promise<void> | void) | undefined;
  onApplyMapping?: ((template: MappingTemplate) => Promise<void> | void) | undefined;
}

function checkTypeCompatibility(sourceType?: string, targetDataType?: string): { compatible: boolean; warning?: string } {
  if (!sourceType || !targetDataType) return { compatible: true };
  const s = sourceType.toLowerCase().trim();
  const t = targetDataType.toLowerCase().trim();
  if (!s || s === 'unknown' || t === 'string') return { compatible: true };

  if (t === 'number' || t === 'integer' || t === 'numeric') {
    if (['number', 'integer', 'float', 'numeric'].includes(s)) return { compatible: true };
    return {
      compatible: false,
      warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
    };
  }

  if (t === 'date') {
    if (['date', 'datetime', 'timestamp'].includes(s)) return { compatible: true };
    return {
      compatible: false,
      warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
    };
  }

  if (t === 'uuid') {
    if (s === 'uuid') return { compatible: true };
    if (['number', 'integer', 'float', 'numeric', 'boolean', 'date', 'datetime', 'timestamp'].includes(s)) {
      return {
        compatible: false,
        warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
      };
    }
  }

  if (t === 'boolean') {
    if (s === 'boolean') return { compatible: true };
    if (['date', 'datetime', 'timestamp', 'uuid', 'json', 'float'].includes(s)) {
      return {
        compatible: false,
        warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
      };
    }
  }

  if (t === 'email') {
    if (['email', 'string'].includes(s)) return { compatible: true };
    return {
      compatible: false,
      warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
    };
  }

  if (t === 'phone') {
    if (['phone', 'string', 'integer'].includes(s)) return { compatible: true };
    return {
      compatible: false,
      warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
    };
  }

  if (t === 'enum') {
    if (['enum', 'string'].includes(s)) return { compatible: true };
    return {
      compatible: false,
      warning: `Incompatible Type: source (${s}) ➔ target (${t})`,
    };
  }

  return { compatible: true };
}

const DEFAULT_TARGET_FIELDS: TargetFieldDefinition[] = [
  { name: 'firstName', label: 'First Name', required: true, dataType: 'string', description: 'Contact given name' },
  { name: 'lastName', label: 'Last Name', required: true, dataType: 'string', description: 'Contact family name' },
  { name: 'email', label: 'Email Address', required: true, dataType: 'email', description: 'Canonical primary email' },
  { name: 'phone', label: 'Phone Number', required: false, dataType: 'phone', description: 'E.164 phone number' },
  { name: 'company', label: 'Company Name', required: false, dataType: 'string', description: 'Organization name' },
  { name: 'country', label: 'Country', required: false, dataType: 'string', description: 'Country code or name' },
  {
    name: 'leadStatus',
    label: 'Lead Status',
    required: false,
    dataType: 'enum',
    allowedValues: ['New', 'Working', 'Qualified', 'Closed'],
    description: 'Current lifecycle lead status',
  },
];

const DEFAULT_SOURCE_COLUMNS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'company',
  'country',
  'annual_revenue',
  'status',
];

/**
 * Migration Kit Step 4: Mapping Screen (FR-MP-01 .. FR-MP-05)
 *
 * Implements source-to-target field mapping, old-to-new value conversion lists,
 * template save/load, and strict required-target field enforcement.
 */
export const MappingScreen: React.FC<MappingScreenProps> = ({
  batchId = 'batch-preview',
  module = 'crm',
  sourceColumns = DEFAULT_SOURCE_COLUMNS,
  sourceColumnTypes,
  sampleData = [],
  targetFields = DEFAULT_TARGET_FIELDS,
  templates = [],
  activeTemplate = null,
  isLoading = false,
  isEmpty = false,
  error = null,
  onSaveTemplate,
  onApplyMapping,
}) => {
  const templateSelectId = useId();
  const templateNameInputId = useId();

  // Mapping state: map of targetField -> sourceColumn
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>(() => {
    if (activeTemplate?.fieldMappings) {
      const initial: Record<string, string> = {};
      for (const m of activeTemplate.fieldMappings) {
        initial[m.targetField] = m.sourceColumn;
      }
      return initial;
    }
    // Auto-match defaults by fuzzy name
    const auto: Record<string, string> = {};
    for (const tf of targetFields) {
      const match = sourceColumns.find(
        (sc) =>
          sc.toLowerCase() === tf.name.toLowerCase() ||
          sc.replace(/_/g, '').toLowerCase() === tf.name.toLowerCase()
      );
      if (match) {
        auto[tf.name] = match;
      }
    }
    return auto;
  });

  // Value conversion state for enum fields
  const [conversions, setConversions] = useState<ValueConversionRule[]>(() => {
    if (activeTemplate?.valueConversions) {
      return activeTemplate.valueConversions;
    }
    return [
      {
        targetField: 'leadStatus',
        mappings: {
          NEW: 'New',
          OPEN: 'New',
          WORKING: 'Working',
          QUALIFIED: 'Qualified',
          CLOSED: 'Closed',
        },
        unmappedAction: 'reject',
      },
    ];
  });

  const [templateName, setTemplateName] = useState(activeTemplate?.name ?? 'Standard CRM Template');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Check required target fields
  const missingRequiredFields = targetFields
    .filter((tf) => tf.required)
    .filter((tf) => {
      const mapped = fieldMappings[tf.name];
      return !mapped || mapped.trim() === '';
    })
    .map((tf) => tf.name);

  const canProceed = missingRequiredFields.length === 0;

  // Evaluate type incompatibilities for mapped fields
  const incompatibleMappings = targetFields
    .map((tf) => {
      const sourceCol = fieldMappings[tf.name];
      if (!sourceCol || !sourceColumnTypes) return null;
      const sourceType = sourceColumnTypes[sourceCol];
      if (!sourceType) return null;
      const result = checkTypeCompatibility(sourceType, tf.dataType);
      if (!result.compatible) {
        return {
          targetField: tf.name,
          targetLabel: tf.label,
          targetType: tf.dataType,
          sourceColumn: sourceCol,
          sourceType,
          warning: result.warning ?? `Incompatible: ${sourceType} ➔ ${tf.dataType}`,
        };
      }
      return null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const handleSourceChange = (targetFieldName: string, sourceCol: string) => {
    setFieldMappings((prev) => ({
      ...prev,
      [targetFieldName]: sourceCol,
    }));
  };

  const handleSaveTemplate = async () => {
    const templatePayload: MappingTemplate = {
      id: activeTemplate?.id,
      module,
      name: templateName,
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: Object.entries(fieldMappings)
        .filter(([, sourceCol]) => sourceCol !== '')
        .map(([targetField, sourceColumn]) => ({
          sourceColumn,
          targetField,
          required: targetFields.find((tf) => tf.name === targetField)?.required ?? false,
          transformation: 'identity',
        })),
      valueConversions: conversions,
      createdBy: 'operator',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (onSaveTemplate) {
      await onSaveTemplate(templatePayload);
    }
    setSaveStatus(`Template "${templateName}" saved successfully.`);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleRunMapping = async () => {
    if (!canProceed) return;
    const templatePayload: MappingTemplate = {
      id: activeTemplate?.id,
      module,
      name: templateName,
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: Object.entries(fieldMappings)
        .filter(([, sourceCol]) => sourceCol !== '')
        .map(([targetField, sourceColumn]) => ({
          sourceColumn,
          targetField,
          required: targetFields.find((tf) => tf.name === targetField)?.required ?? false,
          transformation: 'identity',
        })),
      valueConversions: conversions,
      createdBy: 'operator',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (onApplyMapping) {
      await onApplyMapping(templatePayload);
    }
  };

  return (
    <div className="cs-page-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Page Header */}
      <div className="cs-page-header" style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: '#111827', margin: 0 }}>
          Step 4: Field Mapping & Value Conversions
        </h1>
        <p className="cs-page-desc" style={{ color: '#4b5563', marginTop: '4px', fontSize: '14px' }}>
          Connect source columns to target fields, declare value conversions, and enforce required schemas before loading into clean tables.
        </p>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading mapping configuration">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '48px', backgroundColor: '#e5e7eb', marginBottom: '12px', borderRadius: '4px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '120px', backgroundColor: '#e5e7eb', marginBottom: '12px', borderRadius: '4px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '240px', backgroundColor: '#e5e7eb', borderRadius: '4px' }} />
          <p className="cs-loading-text" style={{ textAlign: 'center', color: '#6b7280', marginTop: '12px' }}>
            Loading field definitions and mapping templates...
          </p>
        </div>
      )}

      {/* Error Card */}
      {!isLoading && error && (
        <div className="cs-error-card" role="alert" style={{ padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', marginBottom: '20px' }}>
          <p className="cs-error-message" style={{ color: '#b91c1c', fontWeight: 500, margin: 0 }}>
            Error configuring mapping: {error}
          </p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && (isEmpty || targetFields.length === 0 || sourceColumns.length === 0) && (
        <div className="cs-empty-state" style={{ padding: '48px', textAlign: 'center', backgroundColor: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '18px', color: '#374151', margin: '0 0 8px 0' }}>No Mapping Fields Available</h3>
          <p style={{ color: '#6b7280', margin: 0 }}>
            No columns or entity target fields were found for batch &quot;{batchId}&quot;. Please complete Steps 1–3 before configuring field mapping.
          </p>
        </div>
      )}

      {/* Active Mapping Workspace */}
      {!isLoading && !error && !isEmpty && targetFields.length > 0 && sourceColumns.length > 0 && (
        <div>
          {/* Required Target Enforcement Banner (FR-MP-04) */}
          <div
            className="cs-enforcement-banner"
            role="status"
            style={{
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '24px',
              backgroundColor: canProceed ? '#f0fdf4' : '#fffbeb',
              border: canProceed ? '1px solid #86efac' : '1px solid #fcd34d',
            }}
          >
            {canProceed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#166534' }}>
                <span aria-hidden="true" style={{ fontSize: '18px' }}>✓</span>
                <span style={{ fontWeight: 500 }}>
                  All required target fields are mapped. Step 4 (Map) and downstream dry-run are ready to execute.
                </span>
              </div>
            ) : (
              <div style={{ color: '#92400e' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span aria-hidden="true" style={{ fontSize: '18px' }}>⚠️</span>
                  <span style={{ fontWeight: 600 }}>Required Target Field Enforcement Block:</span>
                </div>
                <p style={{ margin: 0, fontSize: '14px' }}>
                  The following required target fields have no source column mapped:{' '}
                  <strong>[{missingRequiredFields.join(', ')}]</strong>. Step 4 (Map) and Step 5 (Dry Run) are
                  blocked before any target table mutation until all required fields are mapped.
                </p>
              </div>
            )}
          </div>

          {/* Type Incompatibility Warning Banner */}
          {incompatibleMappings.length > 0 && (
            <div
              className="cs-type-warning-banner"
              role="alert"
              style={{
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '24px',
                backgroundColor: '#fffbeb',
                border: '1px solid #f59e0b',
                color: '#92400e',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span aria-hidden="true" style={{ fontSize: '18px' }}>⚠️</span>
                <span style={{ fontWeight: 600 }}>Type Incompatibility Warning:</span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                Attempting to map incompatible source types. The following {incompatibleMappings.length} mapping(s) may fail validation or cause data loss:
              </p>
              <ul style={{ margin: '0 0 0 20px', padding: 0, fontSize: '13px' }}>
                {incompatibleMappings.map((inc) => (
                  <li key={inc.targetField} style={{ marginBottom: '4px' }}>
                    Target field <strong>{inc.targetLabel} ({inc.targetField})</strong> expects <code>{inc.targetType}</code>, but source column <code>{inc.sourceColumn}</code> is profiled as <code>{inc.sourceType}</code>.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Template Bar */}
          <div
            className="cs-template-bar"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              marginBottom: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label htmlFor={templateNameInputId} style={{ fontWeight: 500, fontSize: '14px', color: '#374151' }}>
                Template Name:
              </label>
              <input
                id={templateNameInputId}
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '14px',
                }}
              />
              <button
                type="button"
                onClick={handleSaveTemplate}
                style={{
                  padding: '6px 16px',
                  backgroundColor: '#4f46e5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '14px',
                }}
              >
                Save Template
              </button>
            </div>

            {templates.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label htmlFor={templateSelectId} style={{ fontWeight: 500, fontSize: '14px', color: '#374151' }}>
                  Load Template:
                </label>
                <select
                  id={templateSelectId}
                  aria-label="Load Existing Template"
                  defaultValue=""
                  onChange={(e) => {
                    const selected = templates.find((t) => t.id === e.target.value);
                    if (selected) {
                      const newMappings: Record<string, string> = {};
                      for (const m of selected.fieldMappings) {
                        newMappings[m.targetField] = m.sourceColumn;
                      }
                      setFieldMappings(newMappings);
                      setTemplateName(selected.name);
                      if (selected.valueConversions) {
                        setConversions(selected.valueConversions);
                      }
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                  }}
                >
                  <option value="" disabled>Choose template...</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} (v{tpl.version})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {saveStatus && (
            <div style={{ color: '#166534', padding: '8px 16px', marginBottom: '16px', backgroundColor: '#f0fdf4', borderRadius: '4px' }}>
              {saveStatus}
            </div>
          )}

          {/* Two-Column Mapping Grid (FR-MP-01) */}
          <div
            className="cs-mapping-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: '16px',
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              overflow: 'hidden',
              marginBottom: '24px',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Target Entity Field</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Requirement</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Type</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Source Column (Left)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Sample Value</th>
                </tr>
              </thead>
              <tbody>
                {targetFields.map((tf) => {
                  const selectedSource = fieldMappings[tf.name] || '';
                  const firstRow = sampleData.length > 0 ? sampleData[0] : undefined;
                  const sampleVal = firstRow && selectedSource ? (firstRow[selectedSource] ?? '-') : '-';
                  const isMissing = tf.required && !selectedSource;

                  return (
                    <tr
                      key={tf.name}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        backgroundColor: isMissing ? '#fffbeb' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: '#111827' }}>
                        <div>{tf.label} <code style={{ fontSize: '12px', color: '#6b7280' }}>({tf.name})</code></div>
                        {tf.description && (
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{tf.description}</div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {tf.required ? (
                          <span
                            className="cs-required-badge"
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              backgroundColor: '#fee2e2',
                              color: '#991b1b',
                              fontSize: '12px',
                              fontWeight: 600,
                              borderRadius: '4px',
                            }}
                          >
                            Required
                          </span>
                        ) : (
                          <span className="cs-optional-badge" style={{ color: '#9ca3af', fontSize: '12px' }}>Optional</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#4b5563' }}>
                        <code style={{ fontSize: '12px', padding: '2px 6px', backgroundColor: '#f3f4f6', borderRadius: '4px' }}>
                          {tf.dataType}
                        </code>
                        {tf.allowedValues && tf.allowedValues.length > 0 && (
                          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                            Allowed: {tf.allowedValues.join(', ')}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {(() => {
                          const selectedSourceType = selectedSource && sourceColumnTypes ? sourceColumnTypes[selectedSource] : undefined;
                          const typeCompat = selectedSourceType ? checkTypeCompatibility(selectedSourceType, tf.dataType) : { compatible: true };

                          return (
                            <div>
                              <select
                                aria-label={`Source column for ${tf.label}`}
                                value={selectedSource}
                                onChange={(e) => handleSourceChange(tf.name, e.target.value)}
                                style={{
                                  width: '100%',
                                  maxWidth: '240px',
                                  padding: '6px 10px',
                                  borderRadius: '6px',
                                  border: isMissing
                                    ? '1px solid #f59e0b'
                                    : !typeCompat.compatible
                                    ? '1px solid #f59e0b'
                                    : '1px solid #d1d5db',
                                  backgroundColor: '#ffffff',
                                  fontSize: '14px',
                                }}
                              >
                                <option value="">-- Unmapped --</option>
                                {sourceColumns.map((col) => (
                                  <option key={col} value={col}>
                                    {col}
                                  </option>
                                ))}
                              </select>
                              {!typeCompat.compatible && (
                                <div
                                  className="cs-incompatible-warning-pill"
                                  role="status"
                                  style={{
                                    marginTop: '6px',
                                    fontSize: '11px',
                                    color: '#b45309',
                                    backgroundColor: '#fef3c7',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontWeight: 500,
                                  }}
                                >
                                  <span aria-hidden="true">⚠️</span> Incompatible Type ({selectedSourceType} ➔ {tf.dataType})
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#6b7280', fontFamily: 'monospace' }}>
                        {sampleVal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Value Conversions Section (FR-MP-02) */}
          <div
            className="cs-conversions-card"
            style={{
              padding: '20px',
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              marginBottom: '24px',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: '0 0 12px 0' }}>
              Value Conversion Tables (Old Value ➔ New Value)
            </h3>
            <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 16px 0' }}>
              Declare value conversions for enumerated domain fields. Unmapped values are handled according to policy.
            </p>

            {conversions.map((rule, idx) => (
              <div key={idx} style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#374151', marginBottom: '8px' }}>
                  Target Field: <code style={{ color: '#4f46e5' }}>{rule.targetField}</code> | Action on Unmapped:{' '}
                  <span style={{ fontWeight: 500, color: '#b91c1c' }}>{rule.unmappedAction}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {Object.entries(rule.mappings).map(([oldVal, newVal]) => (
                    <span
                      key={oldVal}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: '#1f2937',
                      }}
                    >
                      <strong style={{ color: '#6b7280' }}>{oldVal}</strong> ➔{' '}
                      <strong style={{ color: '#166534' }}>{newVal}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
            <button
              type="button"
              disabled={!canProceed}
              onClick={handleRunMapping}
              style={{
                padding: '10px 24px',
                backgroundColor: canProceed ? '#16a34a' : '#9ca3af',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: canProceed ? 'pointer' : 'not-allowed',
                fontWeight: 600,
                fontSize: '15px',
              }}
            >
              Execute Step 4: Map & Save to clean_crm
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
