export interface DatabaseTableUsage {name:string;bytes:number;indexBytes:number;estimatedRows:number;deadRows:number}
export interface PlanDatabaseLoad {plan:string;activeMonitors:number;checksPerDay:number;retainedChecks:number;retainedHours:number}
export interface SupabaseUsage {
  fetchedAt:number;databaseBytes:number;applicationBytes:number;indexBytes:number;
  databaseConnections:number;applicationConnections:number;maxConnections:number;cacheHitPercent:number|null;
  tables:DatabaseTableUsage[];plans:PlanDatabaseLoad[];
}
export const SUPABASE_REFERENCE={checkedOn:'2026-10-23',freeDatabaseBytes:500_000_000,freeEgressBytes:5_000_000_000,proBaseUsd:25,proDiskBytes:8_000_000_000,proEgressBytes:250_000_000_000,diskUsdPerGB:.125,egressUsdPerGB:.09} as const;
export function storageProjection(usage:SupabaseUsage,multiplier=1){
  if(!Number.isFinite(multiplier)||multiplier<0||multiplier>100000)throw new Error('Invalid capacity multiplier');
  const table=(name:string)=>usage.tables.find(t=>t.name===name),checks=table('checks'),hours=table('hourly_stats');
  const calibrated=Boolean(checks&&checks.estimatedRows>=100&&hours&&hours.estimatedRows>=24);
  // Small PostgreSQL relations contain whole pages; a ratio with two rows is
  // misleading. Use explicit planning assumptions until statistics are useful.
  const checkBytes=checks&&checks.estimatedRows>=100?Math.ceil(checks.bytes/checks.estimatedRows):400;
  const hourBytes=hours&&hours.estimatedRows>=24?Math.ceil(hours.bytes/hours.estimatedRows):240;
  const checksPerDay=usage.plans.reduce((n,p)=>n+p.checksPerDay,0)*multiplier;
  const retainedChecks=usage.plans.reduce((n,p)=>n+p.retainedChecks,0)*multiplier;
  const retainedHours=usage.plans.reduce((n,p)=>n+p.retainedHours,0)*multiplier;
  const baseline=Math.max(0,usage.databaseBytes-(checks?.bytes??0)-(hours?.bytes??0));
  const fullHistoryBytes=Math.ceil(Math.max(usage.databaseBytes,baseline+(retainedChecks*checkBytes+retainedHours*hourBytes)*1.3));
  const freePercent=fullHistoryBytes/SUPABASE_REFERENCE.freeDatabaseBytes*100;
  return {calibrated,checkBytes,hourBytes,checksPerDay,retainedChecks,retainedHours,fullHistoryBytes,freePercent,
    grossGrowthBytesPerDay:Math.ceil((checksPerDay*checkBytes+usage.plans.reduce((n,p)=>n+p.activeMonitors*24,0)*multiplier*hourBytes)*1.3)};
}
export function supabaseProBudget(provisionedDiskGB:number,egressGB:number,computeUsd=10){
  if([provisionedDiskGB,egressGB,computeUsd].some(n=>!Number.isFinite(n)||n<0))throw new Error('Invalid budget');
  return SUPABASE_REFERENCE.proBaseUsd+Math.max(0,computeUsd-10)+Math.max(0,provisionedDiskGB-8)*SUPABASE_REFERENCE.diskUsdPerGB+Math.max(0,egressGB-250)*SUPABASE_REFERENCE.egressUsdPerGB;
}
