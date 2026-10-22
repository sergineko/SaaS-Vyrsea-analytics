import type { DashboardData, Monitor } from './types';
export function domainSummaries(data:DashboardData) {
  const groups=new Map<string,{domain:string;monitors:Monitor[];total:number;successful:number;totalMs:number}>(), byMonitor=new Map<string,string>();
  for(const monitor of data.monitors){const domain=monitor.rootDomain;byMonitor.set(monitor.id,domain);if(!groups.has(domain))groups.set(domain,{domain,monitors:[],total:0,successful:0,totalMs:0});groups.get(domain)!.monitors.push(monitor);}
  for(const stat of data.stats){const domain=byMonitor.get(stat.monitorId),group=domain===undefined?undefined:groups.get(domain);if(group){group.total+=stat.total;group.successful+=stat.successful;group.totalMs+=stat.totalMs;}}
  return [...groups.values()].sort((a,b)=>a.domain.localeCompare(b.domain));
}
export function workspaceReportCSV(data:DashboardData) {
  const rows:(string|number)[][]=[['Vyrsea · informe de monitorización','Usuario',data.user.username],['Periodo (días)',data.windowDays,'Corte UTC',new Date(data.serverTime*1000).toISOString()],['Dominio','Monitores','Comprobaciones','Correctas','Disponibilidad (%)','Respuesta media (ms)'],
    ...domainSummaries(data).map(group=>[group.domain,group.monitors.length,group.total,group.successful,group.total?Number((group.successful/group.total*100).toFixed(4)):'Sin datos',group.total?Math.round(group.totalMs/group.total):'Sin datos']),
    ['Medición','Disponibilidad por comprobaciones desde Cloudflare. No mide tiempo exacto ni carga de página.']];
  return '\uFEFF'+rows.map(row=>row.map(value=>{let cell=String(value);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell))cell="'"+cell;return `"${cell.replaceAll('"','""')}"`;}).join(';')).join('\r\n');
}
