/**
 * ClearShift Migration Kit — k6 API & Worker Performance Load Script (KIT-18)
 *
 * Simulates concurrent virtual users (VUs) and worker interactions:
 * - Batch intake / creation
 * - Pipeline steps triggering (profile, clean, dry-run, load in 500-row chunks, reconcile)
 * - Status & reconciliation polling
 * - Threshold validation: p(95) < 500ms, p(99) < 1000ms, error rate < 1%
 *
 * Execution:
 *   k6 run apps/migration-kit/tests/performance/k6-migration-api-worker.js
 */

// @ts-nocheck
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

export const errorRate = new Rate('errors');
export const batchDuration = new Trend('batch_processing_duration_ms');
export const reconciliationExact = new Counter('reconciliation_exact_count');

export const options = {
  stages: [
    { duration: '5s', target: 5 },   // Ramp-up to 5 VUs
    { duration: '15s', target: 10 }, // Sustained load at 10 VUs
    { duration: '5s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.CS_BASE_URL || 'http://localhost:3000';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer k6-test-token-migration-runner',
    },
  };

  group('Migration Kit API Worker Interaction', () => {
    // Step 1: Create Batch
    const createPayload = JSON.stringify({
      module: 'crm1',
      entity: 'contacts',
      name: `k6-perf-batch-vu${__VU}-${Date.now()}`,
      sourceType: 'csv',
      rowCount: 500,
    });

    const createRes = http.post(`${BASE_URL}/api/v1/migration-kit/batches`, createPayload, params);
    const createSuccess = check(createRes, {
      'batch created status is 201 or 200': (r) => r.status === 201 || r.status === 200,
      'batch has id': (r) => {
        try {
          return JSON.parse(r.body || '{}').id !== undefined;
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!createSuccess);

    let batchId = 'B-00001';
    try {
      const parsed = JSON.parse(createRes.body);
      if (parsed.id) batchId = parsed.id;
    } catch {
      // Fallback
    }

    // Step 2: Trigger profile
    const profileRes = http.post(`${BASE_URL}/api/v1/migration-kit/batches/${batchId}/steps/profile`, '{}', params);
    check(profileRes, {
      'profile step returns 200': (r) => r.status === 200,
    });

    // Step 3: Trigger dry-run
    const dryRunRes = http.post(`${BASE_URL}/api/v1/migration-kit/batches/${batchId}/steps/dry-run`, '{}', params);
    check(dryRunRes, {
      'dry-run step returns 200': (r) => r.status === 200,
    });

    // Step 4: Dispatch chunked load
    const loadRes = http.post(
      `${BASE_URL}/api/v1/migration-kit/batches/${batchId}/steps/load`,
      JSON.stringify({ chunkSize: 500 }),
      params
    );
    check(loadRes, {
      'load step returns 200': (r) => r.status === 200,
    });

    // Step 5: Check reconciliation status
    const reconRes = http.get(`${BASE_URL}/api/v1/migration-kit/batches/${batchId}/reconciliation`, params);
    const reconSuccess = check(reconRes, {
      'reconciliation status is 200': (r) => r.status === 200,
      'formula holds': (r) => {
        try {
          const body = JSON.parse(r.body || '{}');
          return body.formulaHolds === true || body.result === 'OK';
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!reconSuccess);
    if (reconSuccess) {
      reconciliationExact.add(1);
    }

    sleep(1);
  });
}
