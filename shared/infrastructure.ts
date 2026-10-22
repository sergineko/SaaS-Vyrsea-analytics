export interface UsageMetric {
  project: number | null; account: number | null; projected: number | null; dailyLimit: number;
  projectRecent?:number|null;accountRecent?:number|null;projectedProject?:number|null;projectSustained24h?:number|null;
}
export interface InfrastructureData {
  configured: boolean; fetchedAt: number; reportedThrough: number; dayStart: number; recentMinutes: number;
  usage: { queues: UsageMetric; d1Reads: UsageMetric; d1Writes: UsageMetric; workers: UsageMetric };
  queue: { backlog: number | null; oldestAgeSeconds: number | null; lagMs: number | null; retries: number | null };
  worker: { errors: number | null; cpuP50Ms: number | null };
  databaseBytes: number | null; errors: string[];
  retention?: {runDay:string;startedAt:number;updatedAt:number;completedAt:number|null;pending:number;deleted:Record<string,number>} | null;
}
export function projectDailyUsage(used: number | null, recent: number | null, reportedThrough: number, dayStart: number) {
  if (used === null || recent === null) return null;
  return Math.ceil(used + recent / 900 * Math.max(0, dayStart + 86400 - reportedThrough));
}
