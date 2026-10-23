export interface UsageMetric {
  project: number | null; account: number | null; projected: number | null; dailyLimit: number|null;
  quota?:{amount:number|null;period:'day'|'month'|'unlimited';plan:'Free'|'Paid';kind:'limit'|'included'};
  projectRecent?:number|null;accountRecent?:number|null;projectedProject?:number|null;projectSustained24h?:number|null;
}
export function serviceQuota(service:'queues'|'workers'|'d1Reads'|'d1Writes'|'hyperdrive',plan:'free'|'paid'='free'):NonNullable<UsageMetric['quota']>{
 const free={queues:10000,workers:100000,d1Reads:5000000,d1Writes:100000,hyperdrive:100000};
 if(plan==='free')return {amount:free[service],period:'day',plan:'Free',kind:'limit'};
 const included={queues:1000000,workers:10000000,d1Reads:25000000000,d1Writes:50000000,hyperdrive:null};
 return {amount:included[service],period:service==='hyperdrive'?'unlimited':'month',plan:'Paid',kind:'included'};
}
export const metricQuota=(metric:UsageMetric)=>metric.quota??{amount:metric.dailyLimit,period:'day' as const,plan:'Free' as const,kind:'limit' as const};
export interface InfrastructureData {
  configured: boolean; fetchedAt: number; reportedThrough: number; dayStart: number; recentMinutes: number;
  usage: { queues: UsageMetric; d1Reads: UsageMetric; d1Writes: UsageMetric; workers: UsageMetric };
  queue: { backlog: number | null; oldestAgeSeconds: number | null; lagMs: number | null; retries: number | null };
  worker: { errors: number | null; cpuP50Ms: number | null };
  databaseBytes: number | null; errors: string[];
  database?: {provider:'d1'|'supabase'; applicationBytes:number|null; storageLimitBytes:number|null};
  supabase?:import('./supabase-usage').SupabaseUsage|null;
  hyperdrive?:{usage:UsageMetric;resultBytesToday:number|null;resultBytesMonth:number|null;projectedMonthBytes:number|null;monthStart:number};
  activation?:{emailReady:boolean;webhooksReady:boolean;customDomainsReady:boolean;encryptedDestinations:boolean};
  retention?: {runDay:string;startedAt:number;updatedAt:number;completedAt:number|null;pending:number;deleted:Record<string,number>} | null;
}
export function projectDailyUsage(used: number | null, recent: number | null, reportedThrough: number, dayStart: number) {
  if (used === null || recent === null) return null;
  return Math.ceil(used + recent / 900 * Math.max(0, dayStart + 86400 - reportedThrough));
}
