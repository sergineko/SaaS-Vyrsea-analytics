import type { DashboardData } from './types';
import { maintenanceFor } from '../shared/maintenance';
export function AdvancedWorkspace({ data }: { data: DashboardData }) {
  if (!data.limits.advancedDashboard) return null;
  const groups = [...new Set(data.monitors.map(m => m.rootDomain))].sort();
  return <section className="panel"><div className="panel-heading"><div><h2>Comparativa de dominios</h2><p>Plataforma avanzada · {data.windowDays} {data.windowDays === 1 ? 'día' : 'días'} de datos de tu cuenta.</p></div><span className="free-tag">{data.limits.name}</span></div><div className="table-scroll"><table className="history-table"><thead><tr><th>Dominio</th><th>Monitores</th><th>Caídos</th><th>Disponibilidad</th><th>Respuesta media</th></tr></thead><tbody>{groups.map(domain => {
    const monitors = data.monitors.filter(m => m.rootDomain === domain);
    const stats = data.stats.filter(s => monitors.some(m => m.id === s.monitorId));
    const total = stats.reduce((n,s) => n+s.total,0);
    const down=monitors.filter(m=>!m.paused&&!maintenanceFor(m.id,data.maintenance)&&m.status==='down').length;
    return <tr key={domain}><th scope="row">{domain}</th><td>{monitors.length}</td><td>{down}</td><td>{total ? `${(stats.reduce((n,s) => n+s.successful,0)/total*100).toLocaleString('es-ES',{maximumFractionDigits:2})} %` : 'Sin datos'}</td><td>{total ? `${Math.round(stats.reduce((n,s) => n+s.totalMs,0)/total)} ms` : 'Sin datos'}</td></tr>;
  })}</tbody></table></div><p className="settings-note">Sondas activas: Cloudflare. La verificación independiente desde AWS y Google Cloud todavía no está operativa. No se muestran ubicaciones ni confirmaciones que aún no se han medido.</p></section>;
}
