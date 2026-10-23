export const BILLING = { provider: 'dodo_payments', enabled: false } as const;

export const PLAN_CATALOG = [
  { id: 'free', name: 'Free', maxDomains: 1, maxMonitors: 2, intervalSeconds: 900, historyDays: 7, priceMonthly: 0, available: true, includedUsers:1,maxUsers:1,extraUserMonthly:0,
    advancedDashboard: false, multiProbe: false, probeProviders: ['cloudflare'],
    features: ['Panel básico', 'Alertas dentro del panel'],
    description: 'Tu dominio y sus dos servicios principales.' },
  { id: 'starter', name: 'Starter', maxDomains: 5, maxMonitors: 15, intervalSeconds: 300, historyDays: 30, priceMonthly: 7.99, available: false, includedUsers:1,maxUsers:1,extraUserMonthly:0,
    advancedDashboard: false, multiProbe: false, probeProviders: ['cloudflare'],
    features: ['Panel básico', 'Alertas por email'],
    description: 'Más dominios y avisos para tu día a día.' },
  { id: 'pro', name: 'Pro / Agencia', maxDomains: 20, maxMonitors: 100, intervalSeconds: 60, historyDays: 90, priceMonthly: 29.99, available: false, includedUsers:1,maxUsers:3,extraUserMonthly:10,
    advancedDashboard: true, multiProbe: true, probeProviders: ['cloudflare', 'aws', 'gcp'],
    features: ['Plataforma avanzada', '1 usuario incluido; hasta 3 (+10 €/mes por adicional)', 'Equipo y permisos', 'Alertas por email', 'Página de estado', 'Webhooks', 'Verificación desde AWS, Google Cloud y Cloudflare'],
    description: 'Una cartera de servicios con verificación entre proveedores.' },
  { id: 'business', name: 'Business', maxDomains: null, maxMonitors: null, intervalSeconds: 60, historyDays: null, priceMonthly: null, available: false, includedUsers:1,maxUsers:null,extraUserMonthly:null,
    advancedDashboard: true, multiProbe: true, probeProviders: ['cloudflare', 'aws', 'gcp'],
    features: ['Plataforma avanzada', '1 usuario incluido; adicionales según contrato', 'Alertas por email', 'Webhooks', 'Informes', 'Equipo y permisos', 'Páginas de estado personalizadas', 'Verificación desde AWS, Google Cloud y Cloudflare'],
    description: 'Capacidad y condiciones adaptadas a tu organización.' },
] as const;

export type PlanId = typeof PLAN_CATALOG[number]['id'];
export interface PlanLimits {
  id: PlanId; name: string; domains: number | null; monitors: number | null; intervalSeconds: number; historyDays: number;
  advancedDashboard: boolean; multiProbe: boolean;
}
export const FREE_LIMITS: PlanLimits = { id: 'free', name: 'Free', domains: 1, monitors: 2, intervalSeconds: 900, historyDays: 7, advancedDashboard: false, multiProbe: false };
export const intervalLabel = (seconds: number) => `${seconds / 60} ${seconds === 60 ? 'minuto' : 'minutos'}`;
export const staleAfterSeconds = (intervalSeconds: number) => intervalSeconds * 3;
export const quotaLabel = (maximum: number | null) => maximum === null ? '∞' : maximum.toLocaleString('es-ES');
export const monthlyPrice = (price: number | null) => price === null ? 'Consultar precios' : `${price.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}/mes`;
