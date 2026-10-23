import {SeatBilling} from './SeatBilling';
import {seatPricing} from '../shared/seats';
import {StatusPageEditor} from './StatusPageEditor';
import {IntegrationGuide} from './IntegrationGuide';
import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, Clock3, Code2, Globe2, LayoutList, Radio, Search, ShieldCheck, Users } from 'lucide-react';
import { DEMO_CLIENTS } from './demo';
import { maintenanceFor } from '../shared/maintenance';
import { Chart, dateTime, Status } from './ui';
import type { DashboardData, Monitor } from './types';
import './advanced-demo.css';

type View = 'portfolio' | 'probes' | 'status' | 'integrations' | 'team' | 'reports';
const format = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const providers = ['Cloudflare', 'AWS', 'Google Cloud'];

function aggregate(data: DashboardData, monitors: Monitor[]) {
  const ids = new Set(monitors.map(m => m.id));
  let total = 0, successful = 0, ms = 0;
  for (const s of data.stats) if (ids.has(s.monitorId)) { total += s.total; successful += s.successful; ms += s.totalMs; }
  return { uptime: total ? format(successful / total * 100) : '—', latency: total ? Math.round(ms / total) : null, total };
}

export function AdvancedDemo({ data, onSelect }: { data: DashboardData; onSelect: (monitor: Monitor) => void }) {
  const business = data.demoContext?.mode === 'business';
  const [view, setView] = useState<View>('portfolio');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [expanded, setExpanded] = useState<string | null>(null);
  const [statusDomain, setStatusDomain] = useState(DEMO_CLIENTS[0].domain as string), [dark, setDark] = useState(false);
  const [role, setRole] = useState('viewer');
  const items: {id:View;name:string;icon:typeof Activity}[] = [
    {id:'portfolio',name:'Cartera',icon:LayoutList}, {id:'probes',name:'Sondas',icon:Radio},
    {id:'status',name:'Páginas de estado',icon:Globe2}, {id:'integrations',name:'Integraciones',icon:Code2},
    {id:'team',name:'Equipo y permisos',icon:Users},...(business ? [{id:'reports' as const,name:'Informes',icon:ArrowDownToLine}] : []),
  ];
  const attention = (m: Monitor) => !m.paused && !maintenanceFor(m.id,data.maintenance) && (m.status === 'down' || m.status === 'degraded');
  const portfolio = useMemo(() => DEMO_CLIENTS.filter(c => data.monitors.some(m => m.rootDomain === c.domain)).map(client => {
    const monitors = data.monitors.filter(m => m.rootDomain === client.domain);
    return {...client,monitors,...aggregate(data,monitors)};
  }), [data]);
  const visible = portfolio.filter(c => `${c.name} ${c.domain} ${c.category}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'attention' ? c.monitors.some(attention) : !c.monitors.some(attention))));
  const metrics = useMemo(() => aggregate(data,data.monitors), [data]);
  const needsAttention = data.monitors.filter(attention);
  const selectedClient = portfolio.find(c => c.domain === statusDomain) ?? portfolio[0];
  const statusMonitors = selectedClient.monitors.filter(m => !m.paused);
  const selectedHasIncident = statusMonitors.some(m => m.status === 'down' && !maintenanceFor(m.id,data.maintenance));
  const selectedMaintenance = statusMonitors.some(m => maintenanceFor(m.id,data.maintenance));
  const selectedPending = statusMonitors.some(m => m.status === 'degraded' || m.status === 'pending');
  const statusHeadline = selectedHasIncident ? 'Incidencia en un servicio' : selectedMaintenance ? 'Mantenimiento programado' : selectedPending ? 'Verificando un servicio' : 'Todos los servicios operativos';
  function exportExample() {
    const rows = [['INFORME SIMULADO VYRSEA', `${data.windowDays} días`, 'Sin mediciones reales'],['Cliente','Dominio','Monitores','Disponibilidad (%)','Respuesta media (ms)'],...portfolio.map(c => [c.name,c.domain,String(c.monitors.length),c.uptime,String(c.latency??'')])];
    const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');link.href=url;link.download='vyrsea-informe-simulado.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="advanced-demo">
    <nav className="advanced-nav" aria-label="Vistas de la demo avanzada">{items.map(({id,name,icon:Icon}) => <button key={id} aria-current={view===id?'page':undefined} className={view===id?'selected':''} onClick={()=>setView(id)}><Icon size={15}/>{name}</button>)}</nav>
    <div className="advanced-caption"><span><i/>VISTA PREVIA INTERACTIVA</span><p>Clientes ficticios y resultados simulados. {business?'Cuotas Business de ejemplo. ':''}Las conexiones externas y los pagos siguen deshabilitados.</p></div>
    {view==='portfolio'&&<>
      <div className="advanced-metrics">
        <div><span>Disponibilidad · {data.windowDays===1?'24 h':`${data.windowDays} días`}</span><strong>{metrics.uptime}<small>%</small></strong><p>Media de las comprobaciones de ejemplo</p></div>
        <div><span>Respuesta media</span><strong>{metrics.latency}<small>ms</small></strong><p>Tiempo de la petición HTTP</p></div>
        <div><span>Cartera de clientes</span><strong>{portfolio.length}<small>dominios</small></strong><p>{data.monitors.length} monitores distribuidos libremente</p></div>
        <div className="attention-metric"><span>Requieren atención</span><strong>{needsAttention.length}<small>servicios</small></strong><p>1 caída · 1 pendiente de confirmar</p></div>
      </div>
      <div className="portfolio-layout"><section className="panel portfolio-panel"><div className="panel-heading"><div><h2>Tu cartera, de un vistazo</h2><p>Despliega un cliente para revisar sus servicios.</p></div><span className="advanced-count">{visible.length} / {portfolio.length}</span></div>
        <div className="portfolio-controls"><label className="search-input"><Search size={15}/><input aria-label="Buscar cliente o dominio" placeholder="Buscar cliente o dominio…" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Estado de la cartera" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos los estados</option><option value="attention">Requieren atención</option><option value="healthy">Sin incidencias activas</option></select></div>
        <div className="table-scroll"><table className="portfolio-table"><thead><tr><th scope="col">Cliente / dominio</th><th scope="col">Monitores</th><th scope="col">Disponibilidad</th><th scope="col">Respuesta</th><th scope="col">Estado</th></tr></thead><tbody>{visible.map(client => {
          const hasAttention=client.monitors.some(attention);
          return <ClientRows key={client.domain} client={client} open={expanded===client.domain} hasAttention={hasAttention} data={data} onToggle={()=>setExpanded(expanded===client.domain?null:client.domain)} onSelect={onSelect}/>;
        })}</tbody></table></div>{!visible.length&&<div className="empty-state"><Search size={22}/><p>No hay clientes con estos filtros.</p><button className="text-button" onClick={()=>{setSearch('');setFilter('all');}}>Restablecer filtros</button></div>}
        <div className="portfolio-footer"><span>{visible.reduce((n,c)=>n+c.monitors.length,0)} monitores en esta vista</span><span>Máximos independientes por cuenta</span></div>
      </section><aside className="portfolio-aside">
        <section className="panel priority-panel"><div className="panel-heading"><div><p className="advanced-eyebrow">PRIORIDAD AHORA</p><h2>API de pedidos</h2></div><span className="status status-down"><i/>Caído</span></div><div className="priority-content"><p>Atelier Norte <span>· api.atelier-norte.example</span></p><div className="incident-emphasis"><Activity size={19}/><div><strong>HTTP 503</strong><span>Incidencia abierta hace 14 min</span></div></div><div className="provider-votes">{providers.map(p=><span key={p}><i/>{p}<b>Error</b></span>)}</div><small>Ejemplo de confirmación 3/3 entre proveedores.</small><button className="text-button" onClick={()=>setView('probes')}>Revisar sondas <ArrowRight size={14}/></button></div></section>
        <section className="panel capacity-panel"><h2>Capacidad del espacio</h2><Quota label="Dominios" used={portfolio.length} max={data.limits.domains}/><Quota label="Monitores" used={data.monitors.length} max={data.limits.monitors}/><p>Atelier Norte utiliza <strong>8 monitores en 1 dominio</strong>. Tú decides cómo distribuir el total.</p>{business&&<small>Ejemplo Business: 50 dominios, 300 monitores y 90 días. Las condiciones reales se acuerdan por contrato.</small>}</section>
      </aside></div>
      <section className="panel advanced-trend"><div className="panel-heading"><div><h2>Rendimiento de la cartera</h2><p>Respuesta media HTTP · datos simulados · {data.windowDays} {data.windowDays===1?'día':'días'}</p></div><Clock3 size={17}/></div><Chart stats={data.stats} days={data.windowDays}/></section>
    </>}
    {view==='probes'&&<section className="panel"><SectionHeading eyebrow="VERIFICACIÓN INDEPENDIENTE" title="Una incidencia, tres puntos de vista" description="Así se presentaría el contraste entre Cloudflare, AWS y Google Cloud. Solo Cloudflare está conectado en el MVP real."/>
      <div className="probe-summary">{providers.map((provider,i)=><div key={provider}><span className="provider-symbol">{['CF','AWS','GC'][i]}</span><div><strong>{provider}</strong><span>Sonda de ejemplo · no conectada en esta demo</span></div><span className="preview-tag">Simulado</span></div>)}</div>
      <div className="table-scroll"><table className="probe-matrix"><caption>Muestra de cuatro servicios · todas las respuestas son simuladas</caption><thead><tr><th scope="col">Servicio</th>{providers.map(p=><th key={p} scope="col">{p}</th>)}<th scope="col">Decisión de ejemplo</th></tr></thead><tbody>{[data.monitors[2],data.monitors.find(m=>m.status==='degraded')!,data.monitors[0],data.monitors[8]].map(m=><tr key={m.id}><th scope="row"><button onClick={()=>onSelect(m)}>{m.name}<small>{new URL(m.url).hostname}</small></button></th>{providers.map((p,i)=>{const failed=m.status==='down'||(m.status==='degraded'&&i===0);return <td key={p}><span className={`probe-result ${failed?'failed':''}`}><i/>{failed?(m.status==='down'?'503 · 864 ms':'Timeout'):`200 · ${m.lastResponseMs===10000?210+i*28:m.lastResponseMs!+i*28} ms`}</span></td>;})}<td><span className={`status status-${m.status}`}><i/>{m.status==='down'?'Caída · 3/3':m.status==='degraded'?'Fallo aislado · 1/3':'Operativo · 3/3'}</span></td></tr>)}</tbody></table></div>
      <div className="advanced-explainer"><ShieldCheck size={20}/><p>La propuesta utiliza un quorum entre proveedores para contrastar errores. Los errores aislados se distinguen de las caídas globales. La integración real y sus reglas de confirmación siguen en desarrollo.</p></div>
    </section>}
    {view==='status'&&<StatusPageEditor data={data} demo/>}
    {view==='integrations'&&<IntegrationGuide/>}
    {view==='team'&&<><SeatBilling subscription={{plan:business?'business':'pro',users:3,pending:0,maximum:business?null:3,billing:seatPricing(business?'business':'pro',3,business?6900:null)}}/><div className="team-layout"><section className="panel"><SectionHeading eyebrow={business?"BUSINESS":"PRO / AGENCIA"} title="El equipo, con el acceso adecuado" description="Usuarios ficticios. Esta vista no invita personas ni modifica permisos reales."/><div className="table-scroll"><table className="team-table"><thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Alcance</th></tr></thead><tbody>{[['Marina Torres','Administradora','Todo el espacio'],['Álex Vidal','Operador','Monitores e incidencias'],['Lucía Serra','Lectora','Cartera y resultados']].map(([name,role,scope])=><tr key={name}><th scope="row"><span className="member-avatar">{name.split(' ').map(n=>n[0]).join('')}</span>{name}</th><td>{role}</td><td>{scope}</td></tr>)}</tbody></table></div></section><section className="panel role-preview"><h2>Explora un rol</h2><p>Simula qué acciones tendría disponibles cada perfil.</p><label>Rol de ejemplo<select aria-label="Rol de ejemplo" value={role} onChange={e=>setRole(e.target.value)}><option value="viewer">Lectura</option><option value="operator">Operación</option><option value="owner">Administrador</option></select></label><ul aria-live="polite">{['Consultar disponibilidad e histórico',...(role!=='viewer'?['Gestionar monitores y mantenimientos']:[]),...(role==='owner'?['Administrar equipo, permisos y configuración']:[])].map(permission=><li key={permission}><Check size={15}/>{permission}</li>)}</ul><small>Simulación local. En tu cuenta, los permisos se comprueban en el servidor.</small></section></div></>}
    {business&&view==='reports'&&<section className="panel"><SectionHeading eyebrow="BUSINESS · INFORME DE EJEMPLO" title="Una revisión lista para compartir" description={`Resumen de los últimos ${data.windowDays} días seleccionados. Todos los datos del informe son simulados.`}/><div className="report-overview"><div><span>ESPACIO</span><h3>Grupo Meridiano</h3><p>{portfolio.length} dominios · {data.monitors.length} monitores · corte {dateTime(data.serverTime)}</p></div><button className="button secondary" onClick={exportExample}><ArrowDownToLine size={16}/>Descargar CSV de ejemplo</button></div><div className="table-scroll"><table className="portfolio-table"><thead><tr><th scope="col">Cliente</th><th scope="col">Monitores</th><th scope="col">Disponibilidad</th><th scope="col">Respuesta media</th></tr></thead><tbody>{portfolio.map(c=><tr key={c.domain}><th scope="row">{c.name}</th><td>{c.monitors.length}</td><td>{c.uptime} %</td><td>{c.latency} ms</td></tr>)}</tbody></table></div><p className="advanced-footnote">El CSV identifica expresamente los datos como simulados. Los informes programados y sus envíos todavía no están operativos.</p></section>}
  </div>;
}

function SectionHeading({eyebrow,title,description}:{eyebrow:string;title:string;description:string}) {
  return <div className="advanced-section-heading"><p className="advanced-eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>;
}
function Quota({label,used,max}:{label:string;used:number;max:number|null}) {
  if(max===null)return <div className="capacity-item"><span>{label}</span><strong>{used} / Sin límite</strong></div>;
  return <div className="capacity-item"><div><span>{label}</span><strong>{used} <small>/ {max} máx.</small></strong></div><div className="capacity-track" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={max}><span style={{width:`${used/(max??1)*100}%`}}/></div></div>;
}
function ClientRows({client,open,hasAttention,data,onToggle,onSelect}:{client:typeof DEMO_CLIENTS[number]&{monitors:Monitor[];uptime:string;latency:number|null};open:boolean;hasAttention:boolean;data:DashboardData;onToggle:()=>void;onSelect:(m:Monitor)=>void}) {
  return <><tr className={open?'expanded-client':''}><th scope="row"><button className="client-toggle" aria-label={`Ver servicios de ${client.name}`} aria-expanded={open} aria-controls={`services-${client.domain}`} onClick={onToggle}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<span className="client-monogram">{client.name.split(' ').map(n=>n[0]).join('')}</span><span><strong>{client.name}</strong><small>{client.domain}</small></span></button></th><td>{client.monitors.length}</td><td>{client.uptime} <small>%</small></td><td>{client.latency} <small>ms</small></td><td><span className={`portfolio-health ${hasAttention?'warn':''}`}><i/>{hasAttention?'Revisar':'Operativo'}</span></td></tr><tr id={`services-${client.domain}`} hidden={!open} className="client-services-row"><td colSpan={5}><div className="client-services"><div className="client-services-heading"><strong>{client.name} · {client.monitors.length} monitores</strong><span>{client.category} · 1 dominio del total</span></div>{client.monitors.map(m=><button key={m.id} onClick={()=>onSelect(m)}><span><strong>{m.name}</strong><small>{new URL(m.url).hostname}</small></span><Status monitor={m} intervalSeconds={60} maintenance={maintenanceFor(m.id,data.maintenance)}/><ChevronRight size={14}/></button>)}</div></td></tr></>;
}
