/**
 * ERP-5 HR & Employees — Migration Kit Field Registry (KIT-14 / H2 / ERP5-22)
 *
 * Registers ERP-5 target schema metadata with the shared Migration Kit registry.
 * Defines target field attributes, human-readable labels, enum options, and
 * required constraints across all owned domain entities:
 * 1. Departments (erp5_departments)
 * 2. Employees (erp5_employees)
 * 3. Leave records (erp5_leave)
 * 4. Payroll totals (erp5_payroll_totals)
 *
 * Invariants Enforced:
 * - Employee identifiers are unique under the declared key (employee_no) (BR-ERP5-01)
 * - Department and user-role references must exist (BR-ERP5-02)
 * - Join date can never precede birth date (BR-ERP5-01)
 * - Salary is never negative (BR-ERP5-02)
 * - Leave end date cannot precede start date (FR-ERP5-04)
 * - Exact duplicate matching and raw source preservation (KIT-08)
 *
 * @module erp5/kit/field-registry
 */

import type {
  ModuleKitMetadata,
  TargetEntityMetadata,
  TargetFieldDefinition,
} from '@cs/kit';
import { migrationKitRegistry } from '@cs/kit';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Departments Target Entity Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const erp5DepartmentsFields: readonly TargetFieldDefinition[] = [
  {
    name: 'name',
    label: 'Department Name',
    type: 'string',
    required: true,
    description: 'Human-readable department title',
    rules: ['FR-ERP5-01'],
    example: 'Engineering',
  },
  {
    name: 'code',
    label: 'Department Code',
    type: 'string',
    required: true,
    description: 'Unique department identifier code',
    rules: ['FR-ERP5-01'],
    example: 'ENG',
  },
  {
    name: 'parentId',
    label: 'Parent Department ID',
    type: 'uuid',
    required: false,
    description: 'Optional UUID referencing the parent department (self-referential hierarchy)',
    rules: ['FR-ERP5-01'],
    example: 'd1000000-0000-4000-8000-000000000001',
  },
];

export const erp5DepartmentsMetadata: TargetEntityMetadata = {
  entity: 'departments',
  label: 'Departments',
  module: 'erp5',
  schemaVersion: 1,
  targetTable: 'erp5_departments',
  primaryKey: 'id',
  naturalKey: 'code',
  fields: erp5DepartmentsFields,
  mappingDefaults: {
    name: 'department_name',
    code: 'department_code',
    parentId: 'parent_department_id',
  },
  validationRules: [
    {
      code: 'FR-ERP5-01',
      description: 'Department code must be unique; parent department must exist when supplied',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Employees Target Entity Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const erp5EmployeesFields: readonly TargetFieldDefinition[] = [
  {
    name: 'employeeNo',
    label: 'Employee Number',
    type: 'string',
    required: true,
    description: 'Unique employee identifier key (declared identity key)',
    rules: ['FR-ERP5-02', 'BR-ERP5-01'],
    example: 'EMP-0001',
  },
  {
    name: 'firstName',
    label: 'First Name',
    type: 'string',
    required: true,
    description: 'Employee given name',
    rules: ['FR-ERP5-02'],
    example: 'Asha',
  },
  {
    name: 'lastName',
    label: 'Last Name',
    type: 'string',
    required: true,
    description: 'Employee family name',
    rules: ['FR-ERP5-02'],
    example: 'Patel',
  },
  {
    name: 'birthDate',
    label: 'Birth Date',
    type: 'date',
    required: true,
    description: 'Date of birth (YYYY-MM-DD); join date must not precede it',
    rules: ['FR-ERP5-02', 'BR-ERP5-01'],
    example: '1990-05-12',
  },
  {
    name: 'joinDate',
    label: 'Join Date',
    type: 'date',
    required: true,
    description: 'Employment start date (YYYY-MM-DD); must not precede birth date',
    rules: ['FR-ERP5-02', 'BR-ERP5-01'],
    example: '2024-01-15',
  },
  {
    name: 'departmentId',
    label: 'Department ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing an existing department (erp5_departments)',
    rules: ['FR-ERP5-02', 'BR-ERP5-02'],
    example: 'd1000000-0000-4000-8000-000000000001',
  },
  {
    name: 'jobTitle',
    label: 'Job Title',
    type: 'string',
    required: true,
    description: 'Position title held by the employee',
    rules: ['FR-ERP5-02'],
    example: 'Platform Engineer',
  },
  {
    name: 'salary',
    label: 'Monthly Salary',
    type: 'decimal',
    required: true,
    description: 'Non-negative monthly salary stored as NUMERIC(20,4); masked at serialization (BR-ERP5-02)',
    rules: ['FR-ERP5-02', 'BR-ERP5-02'],
    example: '75000.0000',
  },
  {
    name: 'currencyCode',
    label: 'Currency Code (ISO-4217)',
    type: 'string',
    required: false,
    description: 'Three-letter currency code of salary (defaults to INR)',
    rules: ['FR-ERP5-02'],
    example: 'INR',
  },
  {
    name: 'sourceSystem',
    label: 'Source System',
    type: 'string',
    required: false,
    description: 'Original legacy system name (preserved immutably)',
    rules: ['KIT-08'],
    example: 'HR_LEGACY',
  },
  {
    name: 'sourceId',
    label: 'Source Record ID',
    type: 'string',
    required: false,
    description: 'Original primary key in source system for idempotency',
    rules: ['KIT-08'],
    example: 'EMP-LEGACY-1001',
  },
];

export const erp5EmployeesMetadata: TargetEntityMetadata = {
  entity: 'employees',
  label: 'Employees',
  module: 'erp5',
  schemaVersion: 1,
  targetTable: 'erp5_employees',
  primaryKey: 'id',
  naturalKey: 'employeeNo',
  fields: erp5EmployeesFields,
  mappingDefaults: {
    employeeNo: 'employee_no',
    firstName: 'first_name',
    lastName: 'last_name',
    birthDate: 'birth_date',
    joinDate: 'join_date',
    departmentId: 'department_id',
    jobTitle: 'job_title',
    salary: 'salary',
    currencyCode: 'currency_code',
    sourceSystem: 'source_system',
    sourceId: 'source_id',
  },
  validationRules: [
    {
      code: 'BR-ERP5-01',
      description: 'Employee number must be unique; join date must not precede birth date',
    },
    {
      code: 'BR-ERP5-02',
      description: 'Department reference must exist; salary must be non-negative',
    },
    {
      code: 'FR-ERP5-02',
      description: 'Employee master record with masked salary projection',
    },
    {
      code: 'KIT-08',
      description: 'Import never changes raw source values (sourceSystem and sourceId are preserved)',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Leave Records Target Entity Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const erp5LeaveFields: readonly TargetFieldDefinition[] = [
  {
    name: 'employeeId',
    label: 'Employee ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing an existing employee (erp5_employees)',
    rules: ['FR-ERP5-04', 'BR-ERP5-02'],
    example: 'e1000000-0000-4000-8000-000000000001',
  },
  {
    name: 'dateFrom',
    label: 'Leave Start Date',
    type: 'date',
    required: true,
    description: 'First day of leave (YYYY-MM-DD)',
    rules: ['FR-ERP5-04'],
    example: '2026-03-02',
  },
  {
    name: 'dateTo',
    label: 'Leave End Date',
    type: 'date',
    required: true,
    description: 'Last day of leave (inclusive); must not precede start date',
    rules: ['FR-ERP5-04'],
    example: '2026-03-04',
  },
  {
    name: 'type',
    label: 'Leave Type',
    type: 'enum',
    required: true,
    description: 'Leave category',
    enumOptions: ['sick', 'holiday', 'other'],
    rules: ['FR-ERP5-04'],
    example: 'sick',
  },
  {
    name: 'status',
    label: 'Leave Status',
    type: 'enum',
    required: false,
    description: 'Approval status (defaults to pending)',
    enumOptions: ['pending', 'approved', 'rejected'],
    rules: ['FR-ERP5-04'],
    example: 'pending',
  },
];

export const erp5LeaveMetadata: TargetEntityMetadata = {
  entity: 'leave',
  label: 'Leave Records',
  module: 'erp5',
  schemaVersion: 1,
  targetTable: 'erp5_leave',
  primaryKey: 'id',
  naturalKey: 'employeeId',
  fields: erp5LeaveFields,
  mappingDefaults: {
    employeeId: 'employee_id',
    dateFrom: 'date_from',
    dateTo: 'date_to',
    type: 'leave_type',
    status: 'leave_status',
  },
  validationRules: [
    {
      code: 'FR-ERP5-04',
      description: 'Leave end date cannot precede start date; referenced employee must exist',
    },
    {
      code: 'BR-ERP5-02',
      description: 'Employee reference must exist',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Payroll Totals Target Entity Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const erp5PayrollTotalsFields: readonly TargetFieldDefinition[] = [
  {
    name: 'departmentId',
    label: 'Department ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing an existing department (erp5_departments)',
    rules: ['FR-ERP5-06'],
    example: 'd1000000-0000-4000-8000-000000000001',
  },
  {
    name: 'month',
    label: 'Month (YYYY-MM)',
    type: 'string',
    required: true,
    description: 'Calendar month label for the aggregate',
    rules: ['FR-ERP5-06'],
    example: '2026-04',
  },
  {
    name: 'headcount',
    label: 'Headcount',
    type: 'number',
    required: true,
    description: 'Number of employees in the department for the month',
    rules: ['FR-ERP5-06'],
    example: 12,
  },
  {
    name: 'totalSalary',
    label: 'Total Salary',
    type: 'decimal',
    required: true,
    description: 'Sum of salaries for the department/month (NUMERIC(20,4))',
    rules: ['FR-ERP5-06'],
    example: '450000.0000',
  },
  {
    name: 'currencyCode',
    label: 'Currency Code (ISO-4217)',
    type: 'string',
    required: true,
    description: 'Three-letter currency code',
    rules: ['FR-ERP5-06'],
    example: 'INR',
  },
];

export const erp5PayrollTotalsMetadata: TargetEntityMetadata = {
  entity: 'payroll_totals',
  label: 'Payroll Totals (Department/Month)',
  module: 'erp5',
  schemaVersion: 1,
  targetTable: 'erp5_payroll_totals',
  primaryKey: 'id',
  naturalKey: 'departmentId',
  fields: erp5PayrollTotalsFields,
  mappingDefaults: {
    departmentId: 'department_id',
    month: 'month',
    headcount: 'headcount',
    totalSalary: 'total_salary',
    currencyCode: 'currency_code',
  },
  validationRules: [
    {
      code: 'FR-ERP5-06',
      description: 'One aggregate per department/month; payroll totals contain aggregates only, no employee rows',
    },
  ],
};

/**
 * Top-Level Module Kit Metadata for ERP-5
 */
export const erp5KitMetadata: ModuleKitMetadata = {
  moduleId: 'erp5',
  moduleName: 'ERP-5 HR and Employees',
  defaultEntity: 'employees',
  entities: {
    departments: erp5DepartmentsMetadata,
    employees: erp5EmployeesMetadata,
    leave: erp5LeaveMetadata,
    payroll_totals: erp5PayrollTotalsMetadata,
  },
  supportedSourceTypes: ['csv', 'xlsx'],
};

// Auto-register with central MigrationKitRegistry on module evaluation (AC 1)
migrationKitRegistry.register(erp5KitMetadata);
