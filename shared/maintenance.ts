export interface MaintenanceWindow {
  id: string; monitorId: string; monitorName: string; startsAt: number; endsAt: number;
  reason: string; createdAt: number; cancelledAt: number | null;
}
export function maintenanceActive(window: MaintenanceWindow, timestamp = Date.now() / 1000) {
  return window.startsAt <= timestamp && window.endsAt > timestamp && (window.cancelledAt === null || window.cancelledAt > timestamp);
}
export function maintenanceFor(monitorId: string, windows: MaintenanceWindow[], timestamp = Date.now() / 1000) {
  return windows.find(window => window.monitorId === monitorId && maintenanceActive(window, timestamp));
}
