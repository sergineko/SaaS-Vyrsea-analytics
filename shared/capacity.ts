// Bounds for the current Free-compatible runner, not a promise of account capacity.
export const JOBS_PER_MESSAGE = 4;
export const SCHEDULER_BATCH_SIZE = 10;
export const QUEUE_FREE_OPERATIONS_PER_DAY = 10_000;

export function estimateCapacity(checksPerDay: number, activeMonitors = JOBS_PER_MESSAGE, fastestChecksPerDay = 0) {
  if (!Number.isSafeInteger(checksPerDay) || checksPerDay < 0) throw new Error('Invalid daily check count');
  return {
    checksPerDay,
    d1WritesBase:checksPerDay*10,
    queueOperationsMin: 3 * Math.max(Math.ceil(checksPerDay / Math.max(1, Math.min(activeMonitors, JOBS_PER_MESSAGE))), fastestChecksPerDay),
    queueOperationsMax: 3 * checksPerDay,
    queueFreeOperations: QUEUE_FREE_OPERATIONS_PER_DAY,
    schedulerChecksPerDay: SCHEDULER_BATCH_SIZE * 1440,
    exceedsQueueFreeMinimum: 3 * Math.max(Math.ceil(checksPerDay / Math.max(1, Math.min(activeMonitors, JOBS_PER_MESSAGE))), fastestChecksPerDay) > QUEUE_FREE_OPERATIONS_PER_DAY,
    exceedsScheduler: checksPerDay > SCHEDULER_BATCH_SIZE * 1440,
  };
}
