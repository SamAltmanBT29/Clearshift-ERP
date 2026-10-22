import {
  globalWorkerMetrics,
  WorkerMetricsTracker,
  getCorrelationId,
  createLogger,
} from "@cs/core";

const logger = createLogger("migration-kit-worker");

export interface WorkerJobContext {
  jobId: string;
  queueName: string;
  correlationId: string;
  data: Record<string, unknown>;
}

export class MigrationWorkerHealthMonitor {
  constructor(private metrics: WorkerMetricsTracker = globalWorkerMetrics) {}

  /**
   * Wraps a background job handler with correlation ID propagation,
   * safe structured logging, duration measurement, and failure tracking.
   */
  async executeJob<T>(
    job: WorkerJobContext,
    handler: (job: WorkerJobContext) => Promise<T>
  ): Promise<T> {
    const correlationId = job.correlationId || getCorrelationId();
    const start = Date.now();

    this.metrics.recordJobStarted(job.jobId, job.queueName);
    logger.info("job.started", `Starting processing for job ${job.jobId} in queue ${job.queueName}`);

    try {
      const result = await handler(job);
      const durationMs = Date.now() - start;

      this.metrics.recordJobCompleted(job.jobId, durationMs);
      logger.info("job.completed", `Job ${job.jobId} completed in ${durationMs}ms`, { duration_ms: durationMs });

      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      this.metrics.recordJobFailed(job.jobId, err, durationMs);

      logger.error(
        "job.failed",
        `Job ${job.jobId} failed in ${durationMs}ms`,
        err,
        "JOB_PROCESSING_FAILED",
        { jobId: job.jobId, queueName: job.queueName }
      );

      throw err;
    }
  }

  /**
   * Updates queue lag (pending/unprocessed jobs count)
   */
  reportQueueLag(pendingCount: number): void {
    this.metrics.updateQueueLag(pendingCount);
  }

  /**
   * Returns worker operational status
   */
  getHealthStatus(): {
    status: "ok" | "degraded";
    queueLag: number;
    activeJobs: number;
    failedJobs: number;
    completedJobs: number;
  } {
    const m = this.metrics.getMetrics();
    // Degraded if queue lag exceeds 1,000 jobs or failure rate is high
    const isDegraded = m.queueLag > 1000 || (m.failedJobs > 0 && m.completedJobs === 0);

    return {
      status: isDegraded ? "degraded" : "ok",
      queueLag: m.queueLag,
      activeJobs: m.activeJobs,
      failedJobs: m.failedJobs,
      completedJobs: m.completedJobs,
    };
  }
}

export const migrationWorkerHealth = new MigrationWorkerHealthMonitor();
