import type { PlanLimits } from '../shared/plans';
import type { MaintenanceWindow } from '../shared/maintenance';
export type User = import('../shared/accounts').AccountUser;
export interface Monitor {
  id: string; userId: string; name: string; url: string; rootDomain: string; paused: boolean;
  status: 'pending' | 'up' | 'degraded' | 'down'; failures: number;
  lastCheckedAt: number | null; lastStatusCode: number | null; lastResponseMs: number | null;
  lastError: string | null; nextCheckAt: number; createdAt: number;
}
export interface HourStat { monitorId: string; hour: number; total: number; successful: number; totalMs: number }
export interface Incident { id: string; monitorId: string; monitorName: string; openedAt: number; resolvedAt: number | null; reason: string }
export interface Notification { id: string; monitorId: string; kind: string; message: string; createdAt: number; readAt: number | null }
export interface DashboardData {
  user: User; monitors: Monitor[]; stats: HourStat[]; incidents: Incident[]; notifications: Notification[];
  maintenance: MaintenanceWindow[];
  limits: PlanLimits; windowDays: number; activeProbeProviders: string[]; multiProbeActive: boolean; serverTime: number;
  demoContext?: { mode: 'free' | 'pro' | 'business'; workspace: string; customQuotaExample: boolean };
}
export interface Check { checkedAt: number; ok: number; statusCode: number | null; responseMs: number; error: string | null }
