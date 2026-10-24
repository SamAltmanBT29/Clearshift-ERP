import { describe, it, expect, vi } from 'vitest';
import { classifyEmployeeCandidate, classifyDepartmentCandidate } from '../../src/domain/duplicate-policy.js';
import type { HrEmployee, HrDepartment } from '@clearshift/contracts';

describe('ERP-5 Duplicate Policy', () => {
  describe('classifyEmployeeCandidate', () => {
    const existingEmployees: HrEmployee[] = [
      { id: '1', employee_no: 'EMP-001', first_name: 'John', last_name: 'Doe', birth_date: '1990-01-01', join_date: '2020-01-01', department_id: 'dept-1', job_title: 'Dev', salary: '1000', currency_code: 'INR' }
    ];

    it('should classify as UNIQUE when no employee_no matches', () => {
      const incoming = { employee_no: 'EMP-999' };
      expect(classifyEmployeeCandidate(incoming, existingEmployees).classification).toBe('UNIQUE');
    });

    it('should classify as EXACT_DUPLICATE when employee_no matches exactly', () => {
      const incoming = { employee_no: 'EMP-001' };
      const result = classifyEmployeeCandidate(incoming, existingEmployees);
      expect(result.classification).toBe('EXACT_DUPLICATE');
      expect(result.candidate?.match_kind).toBe('EXACT');
    });

    it('should classify as EXACT_DUPLICATE when employee_no matches normalized', () => {
      const incoming = { employee_no: ' emp-001 ' };
      const result = classifyEmployeeCandidate(incoming, existingEmployees);
      expect(result.classification).toBe('EXACT_DUPLICATE');
      expect(result.candidate?.match_kind).toBe('NORMALIZED_EXACT');
    });

    it('should classify as AMBIGUOUS_CANDIDATE when multiple employees match', () => {
      const multiExisting: HrEmployee[] = [
        { id: '1', employee_no: 'EMP-001', first_name: 'A', last_name: 'B', birth_date: '1990-01-01', join_date: '2020-01-01', department_id: 'd1', job_title: 'T', salary: '1', currency_code: 'INR' },
        { id: '2', employee_no: 'EMP-001', first_name: 'C', last_name: 'D', birth_date: '1990-01-01', join_date: '2020-01-01', department_id: 'd1', job_title: 'T', salary: '1', currency_code: 'INR' },
      ];
      const incoming = { employee_no: 'EMP-001' };
      expect(classifyEmployeeCandidate(incoming, multiExisting).classification).toBe('AMBIGUOUS_CANDIDATE');
    });
  });

  describe('classifyDepartmentCandidate', () => {
    const existingDepts: HrDepartment[] = [
      { id: 'd1', name: 'Engineering', code: 'ENG', parent_id: null }
    ];

    it('should classify as UNIQUE when no code matches', () => {
      const incoming = { code: 'SALES' };
      expect(classifyDepartmentCandidate(incoming, existingDepts).classification).toBe('UNIQUE');
    });

    it('should classify as EXACT_DUPLICATE when code matches exactly', () => {
      const incoming = { code: 'ENG' };
      const result = classifyDepartmentCandidate(incoming, existingDepts);
      expect(result.classification).toBe('EXACT_DUPLICATE');
      expect(result.candidate?.match_kind).toBe('EXACT');
    });

    it('should classify as EXACT_DUPLICATE when code matches normalized', () => {
      const incoming = { code: ' eng ' };
      const result = classifyDepartmentCandidate(incoming, existingDepts);
      expect(result.classification).toBe('EXACT_DUPLICATE');
      expect(result.candidate?.match_kind).toBe('NORMALIZED_EXACT');
    });
  });
});
