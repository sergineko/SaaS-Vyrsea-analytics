import type { DashboardData } from './types';
import { FREE_LIMITS, PLAN_CATALOG } from '../shared/plans';
import type { DemoMode } from './demo-mode';

export const DEMO_CLIENTS = [
  { domain: 'atelier-norte.example', name: 'Atelier Norte', category: 'Comercio', count: 8 },
  { domain: 'hotel-brisa.example', name: 'Hotel Brisa', category: 'Turismo', count: 5 },
  { domain: 'editorial-faro.example', name: 'Editorial Faro', category: 'Contenido', count: 4 },
  { domain: 'clinica-alba.example', name: 'Clínica Alba', category: 'Servicios', count: 3 },
  { domain: 'cafe-origen.example', name: 'Café Origen', category: 'Comercio', count: 2 },
  { domain: 'estudio-lima.example', name: 'Estudio Lima', category: 'Servicios', count: 2 },
  { domain: 'logistica-sur.example', name: 'Logística Sur', category: 'Operaciones', count: 6 },
  { domain: 'grupo-olmo.example', name: 'Grupo Olmo', category: 'Operaciones', count: 5 },
  { domain: 'reserva-verde.example', name: 'Reserva Verde', category: 'Turismo', count: 7 },
] as const;

export function demoData(days = 1, mode: DemoMode = 'free'): DashboardData {
  if (mode !== 'free') return advancedDemoData(days, mode);
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600) * 3600;
  const names = ['Web corporativa', 'Tienda online'];
  const domains = ['https://www.estudio-norte.es', 'https://tienda.estudio-norte.es'];
  const monitors: DashboardData['monitors'] = names.map((name, i) => ({ id: `demo-${i}`, userId: 'demo', name, url: domains[i], rootDomain: 'estudio-norte.es', paused: false,
    status: i === 1 ? 'down' : 'up', failures: i === 1 ? 3 : 0, lastCheckedAt: now - (i === 0 ? 642 : 42), lastStatusCode: i === 1 ? 503 : 200,
    lastResponseMs: [182, 834][i], lastError: i === 1 ? 'HTTP 503' : null, nextCheckAt: now + (i === 0 ? 1800 : 858), createdAt: now - 604800,
  }));
  return {
    user: { id: 'demo', username: 'estudio', createdAt: now - 604800 }, monitors,
    maintenance: [
      {id:'maintenance-demo-active',monitorId:'demo-0',monitorName:'Web corporativa',startsAt:now-600,endsAt:now+1800,reason:'Actualización programada de la web',createdAt:now-3600,cancelledAt:null},
      {id:'maintenance-demo-next',monitorId:'demo-1',monitorName:'Tienda online',startsAt:now+86400,endsAt:now+90000,reason:'Actualización del catálogo',createdAt:now-3600,cancelledAt:null},
    ],
    stats: monitors.flatMap((monitor, i) => Array.from({ length: 24 * days }, (_, j) => {
      const bucket=hour-(24*days-1-j)*3600,last=monitor.lastCheckedAt!;
      const total=Math.max(0,Math.floor((Math.min(bucket+3599,last)-last)/900)-Math.ceil((bucket-last)/900)+1);
      const failed=i===1?[0,1,2].filter(offset=>last-offset*900>=bucket&&last-offset*900<bucket+3600).length:0;
      return {monitorId:monitor.id,hour:bucket,total,successful:total-failed,totalMs:total*([182,246][i]+Math.round(Math.sin(j*1.6+i)*40))};
    })),
    incidents: [
      { id: 'incident-1', monitorId: 'demo-1', monitorName: 'Tienda online', openedAt: now - 2700, resolvedAt: null, reason: 'HTTP 503' },
      { id: 'incident-2', monitorId: 'demo-0', monitorName: 'Web corporativa', openedAt: now - 97000, resolvedAt: now - 96100, reason: 'Tiempo de espera agotado (10 s).' },
    ].filter(incident=>incident.resolvedAt===null||incident.resolvedAt>=now-days*86400),
    notifications: [{ id: 'notification-1', monitorId: 'demo-1', kind: 'down', message: 'Tienda online no responde. Dos fallos consecutivos confirmados.', createdAt: now - 2700, readAt: null }],
    limits: FREE_LIMITS, windowDays: days, activeProbeProviders: ['cloudflare'], multiProbeActive: false, serverTime: now,
    demoContext: { mode: 'free', workspace: 'Estudio Norte', customQuotaExample: false },
  };
}

function advancedDemoData(requestedDays: number, mode: 'pro' | 'business'): DashboardData {
  const plan = PLAN_CATALOG.find(p => p.id === mode)!;
  const days = Math.max(1, Math.min(90, Math.floor(requestedDays) || 1));
  const now = Math.floor(Date.now() / 1000), hour = Math.floor(now / 3600) * 3600;
  const clients = DEMO_CLIENTS.slice(0, mode === 'business' ? 9 : 6);
  const services = ['Web principal', 'Tienda online', 'API de pedidos', 'Área de clientes', 'Reservas', 'Documentación', 'Acceso', 'Contenido'];
  const subdomains = ['www', 'tienda', 'api', 'clientes', 'reservas', 'docs', 'auth', 'cdn'];
  const monitors: DashboardData['monitors'] = clients.flatMap((client, i) => Array.from({ length: client.count }, (_, j) => {
    const down = i === 0 && j === 2, degraded = i === 2 && j === 0, paused = i === 5 && j === 1;
    return { id: `demo-${i}-${j}`, userId: 'demo', name: services[j], url: `https://${subdomains[j]}.${client.domain}`, rootDomain: client.domain,
      paused, status: down ? 'down' : degraded ? 'degraded' : 'up', failures: down ? 15 : degraded ? 1 : 0,
      lastCheckedAt: now - (paused ? 7200 : i === 1 && j === 3 ? 600 : 12 + (i * 7 + j * 3) % 40),
      lastStatusCode: down ? 503 : degraded ? null : 200, lastResponseMs: down ? 864 : degraded ? 10000 : 125 + i * 23 + j * 17,
      lastError: down ? 'HTTP 503' : degraded ? 'Tiempo de espera agotado (10 s).' : null, nextCheckAt: now + 30, createdAt: now - 120 * 86400 };
  }));
  const maintenance: DashboardData['maintenance'] = [
    {id:'demo-maintenance-active',monitorId:'demo-1-3',monitorName:'Área de clientes · Hotel Brisa',startsAt:now-600,endsAt:now+1800,reason:'Despliegue del motor de reservas',createdAt:now-86400,cancelledAt:null},
    {id:'demo-maintenance-next',monitorId:'demo-0-1',monitorName:'Tienda online · Atelier Norte',startsAt:now+86400,endsAt:now+90000,reason:'Actualización del catálogo',createdAt:now-3600,cancelledAt:null},
  ];
  const countSlots = (start: number, end: number, last: number) => Math.max(0, Math.floor((end - last) / 60) - Math.ceil((start - last) / 60) + 1);
  const stats: DashboardData['stats'] = monitors.flatMap((monitor, index) => Array.from({length:24*days},(_,j) => {
    const bucket=hour-(24*days-1-j)*3600, end=Math.min(bucket+3599,monitor.lastCheckedAt!);
    const total=countSlots(bucket,end,monitor.lastCheckedAt!);
    const failed=monitor.status==='down'?countSlots(Math.max(bucket,now-900),end,monitor.lastCheckedAt!):monitor.status==='degraded'&&end>=monitor.lastCheckedAt!?1:0;
    const resolvedFailures=monitor.id==='demo-3-0'?countSlots(Math.max(bucket,now-28800),Math.min(end,now-28201),monitor.lastCheckedAt!):0;
    return {monitorId:monitor.id,hour:bucket,total,successful:Math.max(0,total-failed-resolvedFailures),totalMs:total*(145+(index*19)%230+Math.round(Math.sin(j/3+index)*25))};
  }));
  return {user:{id:'demo',username:mode==='business'?'grupo-meridiano':'norte-digital',createdAt:now-120*86400},monitors,stats,maintenance,
    incidents:[{id:'demo-open',monitorId:'demo-0-2',monitorName:'API de pedidos · Atelier Norte',openedAt:now-840,resolvedAt:null,reason:'HTTP 503 · ejemplo de caída confirmada'},
      {id:'demo-resolved',monitorId:'demo-3-0',monitorName:'Web principal · Clínica Alba',openedAt:now-28800,resolvedAt:now-28200,reason:'Tiempo de espera agotado · ejemplo resuelto'}],
    notifications:[{id:'demo-notice',monitorId:'demo-0-2',kind:'down',message:'Atelier Norte · API de pedidos no disponible. Incidencia de ejemplo.',createdAt:now-840,readAt:null}],
    limits:{id:mode,name:plan.name,domains:plan.maxDomains??50,monitors:plan.maxMonitors??300,historyDays:plan.historyDays??90,intervalSeconds:60,advancedDashboard:true,multiProbe:true},
    windowDays:days,activeProbeProviders:['cloudflare'],multiProbeActive:false,serverTime:now,
    demoContext:{mode,workspace:mode==='business'?'Grupo Meridiano':'Norte Digital',customQuotaExample:mode==='business'},
  };
}
