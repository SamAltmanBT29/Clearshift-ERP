import {
  ColumnProfile,
  InferredDataType,
  TopValue,
} from '@clearshift/contracts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s().-]{7,25}$/;
const INTEGER_REGEX = /^-?\d+$/;
const DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Checks if a string value is a valid ISO date or date string
 */
function isValidDate(value: string): boolean {
  if (value.length < 8) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * Checks if a string value is valid JSON
 */
function isValidJson(value: string): boolean {
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Infers the dominant data type for a list of values
 */
export function inferColumnType(values: string[]): InferredDataType {
  const nonEmpties = values.filter((v) => v !== '' && v.trim() !== '');
  if (nonEmpties.length === 0) return 'string';

  let uuidCount = 0;
  let emailCount = 0;
  let phoneCount = 0;
  let intCount = 0;
  let decimalCount = 0;
  let dateCount = 0;
  let jsonCount = 0;
  let boolCount = 0;

  for (const raw of nonEmpties) {
    const val = raw.trim();
    if (UUID_REGEX.test(val)) uuidCount++;
    else if (EMAIL_REGEX.test(val)) emailCount++;
    else if (PHONE_REGEX.test(val)) phoneCount++;
    else if (INTEGER_REGEX.test(val)) intCount++;
    else if (DECIMAL_REGEX.test(val)) decimalCount++;
    else if (isValidDate(val)) dateCount++;
    else if (isValidJson(val)) jsonCount++;
    else if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false') boolCount++;
  }

  const sampleSize = nonEmpties.length;
  // If >50% of valid format matches a specific type, classify as that type
  if (uuidCount / sampleSize >= 0.5) return 'uuid';
  if (emailCount / sampleSize >= 0.5) return 'email';
  if (phoneCount / sampleSize >= 0.5) return 'phone';
  if (intCount / sampleSize >= 0.5) return 'integer';
  if (decimalCount / sampleSize >= 0.5) return 'decimal';
  if (dateCount / sampleSize >= 0.5) return 'date';
  if (jsonCount / sampleSize >= 0.5) return 'json';
  if (boolCount / sampleSize >= 0.5) return 'boolean';

  return 'string';
}

/**
 * Validates a single value against the inferred or declared type
 */
export function isValidForType(value: string, type: InferredDataType): boolean {
  const val = value.trim();
  if (val === '') return true; // Empties are tracked in emptyCount, not format errors

  switch (type) {
    case 'uuid':
      return UUID_REGEX.test(val);
    case 'email':
      return EMAIL_REGEX.test(val);
    case 'phone':
      return PHONE_REGEX.test(val);
    case 'integer':
      return INTEGER_REGEX.test(val);
    case 'decimal':
      return DECIMAL_REGEX.test(val);
    case 'date':
      return isValidDate(val);
    case 'boolean':
      return val.toLowerCase() === 'true' || val.toLowerCase() === 'false' || val === '1' || val === '0';
    case 'json':
      return isValidJson(val);
    case 'string':
    default:
      return true;
  }
}

export interface ProfileColumnOptions {
  declaredType?: InferredDataType;
}

/**
 * Computes profiling statistics for a single column across all rows
 */
export function profileColumn(
  columnName: string,
  values: string[],
  options: ProfileColumnOptions = {}
): ColumnProfile {
  const totalRows = values.length;
  let emptyCount = 0;
  const frequencyMap = new Map<string, number>();

  let minValue: string | null = null;
  let maxValue: string | null = null;

  for (const raw of values) {
    const isBlank = raw === '' || raw.trim() === '';
    if (isBlank) {
      emptyCount++;
    } else {
      const trimmed = raw.trim();
      frequencyMap.set(trimmed, (frequencyMap.get(trimmed) || 0) + 1);

      if (minValue === null || trimmed < minValue) {
        minValue = trimmed;
      }
      if (maxValue === null || trimmed > maxValue) {
        maxValue = trimmed;
      }
    }
  }

  const distinctCount = frequencyMap.size;
  const inferredType = options.declaredType || inferColumnType(values);

  // Compute invalid count based on inferred/declared type
  let invalidCount = 0;
  for (const raw of values) {
    if (raw !== '' && raw.trim() !== '') {
      if (!isValidForType(raw, inferredType)) {
        invalidCount++;
      }
    }
  }

  // Compute top 5 values sorted deterministically (count desc, value asc)
  const sortedEntries = Array.from(frequencyMap.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1]; // highest count first
    }
    return a[0].localeCompare(b[0]); // alphabetical tie-break
  });

  const topValues: TopValue[] = sortedEntries.slice(0, 5).map(([val, count]) => ({
    value: val,
    count,
    percentage: totalRows > 0 ? Number(((count / totalRows) * 100).toFixed(2)) : 0,
  }));

  return {
    columnName,
    totalRows,
    emptyCount,
    distinctCount,
    invalidCount,
    inferredType,
    topValues,
    minValue,
    maxValue,
  };
}
