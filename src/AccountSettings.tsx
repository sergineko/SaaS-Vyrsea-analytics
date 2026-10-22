import { ShieldCheck } from 'lucide-react';
import { intervalLabel } from '../shared/plans';
import { PlanComparison } from './PlanComparison';
import type { DashboardData } from './types';

export function AccountSettings({ data }: { data: DashboardData }) {
  const domains = new Set(data.monitors.map(m => m.rootDomain));
  return <><section className="panel settings-panel"><div className="panel-heading"><div><h2>Tu plan y su uso</h2><p>{data.demoContext ? `Ejemplo del plan ${data.limits.name}. Las cuotas no se asignan a ninguna cuenta real.${data.demoContext.customQuotaExample ? ' Business muestra condiciones ficticias de contrato.' : ''}` : 'Las cuotas, frecuencia e histórico se aplican en el servidor.'}</p></div><span className="free-tag">{data.limits.name}</span></div><p className="settings-note">Dominios y monitores son máximos independientes. Puedes usar los 15 monitores de Starter entre 2 dominios, hasta un máximo de 5 dominios. No hay una cuota de monitores por dominio.</p><dl>
    <div><dt>Usuario</dt><dd>{data.user.username}</dd></div><div><dt>Dominios</dt><dd>{domains.size} de {data.limits.domains}</dd></div><div><dt>Monitores totales</dt><dd>{data.monitors.length} de {data.limits.monitors} · los pausados también cuentan</dd></div>
    <div><dt>Frecuencia</dt><dd>Cada {intervalLabel(data.limits.intervalSeconds)}</dd></div><div><dt>Histórico</dt><dd>{data.limits.historyDays} días de resultados e incidencias resueltas</dd></div><div><dt>Plataforma</dt><dd>{data.limits.advancedDashboard ? 'Avanzada · Pro / Agencia y Business' : 'Básica · Free y Starter'}</dd></div>
    <div><dt>Confirmación de caídas</dt><dd>2 fallos consecutivos</dd></div><div><dt>Alertas activas</dt><dd>Dentro del panel · actualización cada minuto</dd></div><div><dt>Sondas activas</dt><dd>Cloudflare · AWS y Google Cloud todavía no operativos</dd></div><div><dt>Contratación</dt><dd>Deshabilitada · sin pagos activos</dd></div><div><dt>Acceso</dt><dd>Passkey · sesión de 7 días</dd></div>
    </dl><p className="settings-note"><ShieldCheck size={18} />Guarda tu passkey en un gestor sincronizado. La recuperación de cuenta todavía está pendiente.</p>{(domains.size > data.limits.domains || data.monitors.length > data.limits.monitors) && <p className="form-error">Tus monitores anteriores se han conservado. Revisa los que exceden la cuota antes de añadir otros.</p>}</section><PlanComparison /></>;
}
