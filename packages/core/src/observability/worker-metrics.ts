export interface WorkerMetricsSummary {
  activeWorkers: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  queueLag: number;
  averageDurationMs: number;
  lastHeartbeat: string;
}

export class WorkerMetricsTracker {
  private activeWorkers = new Set<string>();
  private completedJobs = 0;
  private failedJobs = 0;
  private activeJobsCount = 0;
  private queueLag = 0;
  private durations: number[] = [];
  private lastHeartbeat = new Date();

  registerWorker(workerId: string): void {
    this.activeWorkers.add(workerId);
    this.lastHeartbeat = new Date();
  }

  unregisterWorker(workerId: string): void {
    this.activeWorkers.delete(workerId);
  }

  recordJobStarted(_jobId: string, _queueName?: string): void {
    this.activeJobsCount++;
    this.lastHeartbeat = new Date();
  }

  recordJobCompleted(_jobId: string, durationMs: number): void {
    this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
    this.completedJobs++;
    this.durations.push(durationMs);
    if (this.durations.length > 100) this.durations.shift();
    this.lastHeartbeat = new Date();
  }

  recordJobFailed(_jobId: string, _error: unknown, durationMs?: number): void {
    this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
    this.failedJobs++;
    if (durationMs !== undefined) {
      this.durations.push(durationMs);
      if (this.durations.length > 100) this.durations.shift();
    }
    this.lastHeartbeat = new Date();
  }

  updateQueueLag(lag: number): void {
    this.queueLag = Math.max(0, lag);
  }

  getMetrics(): WorkerMetricsSummary {
    const avgDuration =
      this.durations.length > 0
        ? Math.round(this.durations.reduce((a, b) => a + b, 0) / this.durations.length)
        : 0;

    return {
      activeWorkers: this.activeWorkers.size,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      activeJobs: this.activeJobsCount,
      queueLag: this.queueLag,
      averageDurationMs: avgDuration,
      lastHeartbeat: this.lastHeartbeat.toISOString(),
    };
  }

  reset(): void {
    this.activeWorkers.clear();
    this.completedJobs = 0;
    this.failedJobs = 0;
    this.activeJobsCount = 0;
    this.queueLag = 0;
    this.durations = [];
    this.lastHeartbeat = new Date();
  }
}

export const globalWorkerMetrics = new WorkerMetricsTracker();
