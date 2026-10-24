import {useEffect,useRef,useState} from 'react';
import {Download,FileText} from 'lucide-react';
import type {DashboardData} from './types';
import {REPORT_KINDS,REPORT_NAMES,reportCSVHeader,reportCSVRows,type ReportKind,type ReportPage} from '../shared/reports';
import {request} from './api';
import './workspace-improvements.css';
const localTime=(time:number)=>{const d=new Date(time*1000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,13)+':00';};
type ExportRun={domains:string[];monitors:string[];from:number;to:number;kinds:ReportKind[];index:number;cursor:{monitor:string;at:number;id:string}|null;part:number};
export function ReportsPanel({data,demo=false}:{data:DashboardData;demo?:boolean}){
 const [domains,setDomains]=useState<string[]>([]),[monitors,setMonitors]=useState<string[]>([]),[period,setPeriod]=useState(String(Math.min(7,data.limits.historyDays))),[kind,setKind]=useState('all');
 const [dates,setDates]=useState({from:localTime(data.serverTime-Math.min(7,data.limits.historyDays)*86400),to:localTime(data.serverTime)}),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[continuation,setContinuation]=useState<ExportRun|null>(null);
 const controller=useRef<AbortController|null>(null);useEffect(()=>()=>controller.current?.abort(),[]);
 const allDomains=[...new Set(data.monitors.map(m=>m.rootDomain))].sort(),eligible=data.monitors.filter(m=>!domains.length||domains.includes(m.rootDomain));
 const reset=()=>{setContinuation(null);setProgress('');setError('');};
 async function generate(){
  setBusy(true);setError('');controller.current=new AbortController();const signal=controller.current.signal;
  try{
   const to=period==='custom'?Math.floor(new Date(dates.to).getTime()/1000):Math.min(data.serverTime,Math.floor(Date.now()/1000)),from=period==='custom'?Math.floor(new Date(dates.from).getTime()/1000):Math.floor(to/3600)*3600-Number(period)*86400+3600;
   if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw new Error('El inicio debe ser anterior al final.');
   const run:ExportRun=continuation?{...continuation}:{from,to,domains,monitors,kinds:kind==='all'?[...REPORT_KINDS]:[kind as ReportKind],index:0,cursor:null,part:1};
   const parts:BlobPart[]=[reportCSVHeader()];let count=0;
   while(run.index<run.kinds.length){
    if(signal.aborted)throw new DOMException('Cancelado','AbortError');
    const current=run.kinds[run.index];setProgress(`${REPORT_NAMES[current]} · ${count.toLocaleString('es-ES')} filas preparadas`);
    let page:ReportPage;
    if(demo){
     const chosen=data.monitors.filter(m=>(!run.domains.length||run.domains.includes(m.rootDomain))&&(!run.monitors.length||run.monitors.includes(m.id)));
     const ids=new Set(chosen.map(m=>m.id));
     const rows=current==='summary'?chosen.map(m=>{const stats=data.stats.filter(s=>s.monitorId===m.id&&s.hour>=run.from&&s.hour<run.to);return {monitor_id:m.id,monitor_name:m.name,domain:m.rootDomain,url:m.url,current_status:m.status,total:stats.reduce((n,s)=>n+s.total,0),successful:stats.reduce((n,s)=>n+s.successful,0),total_ms:stats.reduce((n,s)=>n+s.totalMs,0),note:'DATOS SIMULADOS · no representan mediciones reales'};}):current==='hourly'?data.stats.filter(s=>ids.has(s.monitorId)&&s.hour>=run.from&&s.hour<Math.floor(run.to/3600)*3600).map(s=>({monitor_id:s.monitorId,monitor_name:chosen.find(m=>m.id===s.monitorId)!.name,record_at:s.hour,total:s.total,successful:s.successful,total_ms:s.totalMs,note:'DATOS SIMULADOS'})):[];
     page={kind:current,rows,from:run.from,to:run.to,generatedAt:data.serverTime,nextCursor:null};
    }else page=await request<ReportPage>('/reports/export?filter='+encodeURIComponent(JSON.stringify({kind:current,from:run.from,to:run.to,domains:run.domains,monitors:run.monitors,cursor:run.cursor})),'GET',undefined,signal);
    parts.push(reportCSVRows(page));count+=page.rows.length;
    run.cursor=page.nextCursor?JSON.parse(page.nextCursor):null;if(!run.cursor)run.index++;
    if(count>=50000)break;
   }
   if(signal.aborted)throw new DOMException('Cancelado','AbortError');
   const url=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`vyrsea-${demo?'demo-':''}informe-${new Date(run.to*1000).toISOString().slice(0,10)}-parte-${run.part}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   const more=run.index<run.kinds.length;setContinuation(more?{...run,part:run.part+1}:null);setProgress(`${count.toLocaleString('es-ES')} filas descargadas en la parte ${run.part}. ${more?'Quedan registros: continúa con la siguiente parte.':'Exportación completada.'}`);
  }catch(e){setError((e as Error).name==='AbortError'?'Exportación cancelada. Puedes volver a iniciarla.':(e as Error).message);}finally{setBusy(false);controller.current=null;}
 }
 return <section className="panel"><div className="panel-heading"><div><span className="small-label">BUSINESS · INFORMES</span><h2><FileText size={19}/>Exporta tus datos de monitorización</h2><p>Elige el alcance, las fechas y el contenido. Sin selección se incluyen todos los dominios y monitores.</p></div></div><div className="product-content">
  {demo&&<p className="product-status-note">Demo con datos simulados: exporta el resumen y los agregados de ejemplo. No se inventan registros de comprobaciones individuales.</p>}
  <div className="report-filter-grid"><div><h3>Dominios <small>· {domains.length||'Todos'}</small></h3><div className="report-picker">{allDomains.map(domain=><label key={domain}><input type="checkbox" disabled={busy} checked={domains.includes(domain)} onChange={e=>{const next=e.target.checked?[...domains,domain]:domains.filter(d=>d!==domain);setDomains(next);setMonitors(monitors.filter(id=>data.monitors.some(m=>m.id===id&&(!next.length||next.includes(m.rootDomain)))));reset();}}/>{domain}</label>)}</div></div><div><h3>Monitores <small>· {monitors.length||'Todos los del alcance'}</small></h3><div className="report-picker">{eligible.map(m=><label key={m.id}><input type="checkbox" disabled={busy} checked={monitors.includes(m.id)} onChange={e=>{setMonitors(e.target.checked?[...monitors,m.id]:monitors.filter(id=>id!==m.id));reset();}}/><span>{m.name}<small> · {m.rootDomain}</small></span></label>)}</div></div></div>
  <div className="report-toolbar"><label>Periodo<select disabled={busy} value={period} onChange={e=>{setPeriod(e.target.value);reset();}}>{[...new Set([1,Math.min(7,data.limits.historyDays),7,30,90])].filter(n=>n<=data.limits.historyDays).map(n=><option key={n} value={n}>{n===1?'Últimas 24 horas':`Últimos ${n} días`}</option>)}<option value="custom">Personalizado</option></select></label><label>Contenido<select disabled={busy} value={kind} onChange={e=>{setKind(e.target.value);reset();}}><option value="all">Informe completo</option>{REPORT_KINDS.map(k=><option value={k} key={k}>{REPORT_NAMES[k]}</option>)}</select></label>{period==='custom'&&<><label>Desde<input disabled={busy} required type="datetime-local" step={3600} min={localTime(data.serverTime-(data.limits.historyDays*24-1)*3600)} value={dates.from} onChange={e=>{setDates({...dates,from:e.target.value});reset();}}/></label><label>Hasta<input disabled={busy} required type="datetime-local" step={3600} max={localTime(data.serverTime)} value={dates.to} onChange={e=>{setDates({...dates,to:e.target.value});reset();}}/></label></>}<button className="button primary" disabled={busy||!data.monitors.length} onClick={()=>void generate()}><Download size={16}/>{continuation?'Descargar siguiente parte':'Generar CSV'}</button>{busy&&<button className="button secondary" onClick={()=>controller.current?.abort()}>Cancelar</button>}</div>
  <p>El informe completo incluye <strong>resumen por monitor, comprobaciones individuales, agregados horarios, incidencias y mantenimientos</strong>. Conserva los identificadores, URL, códigos HTTP, tiempos, errores, estados y sondas, para que puedas cruzar los registros en tu hoja de cálculo.</p><p className="muted">Se exporta el histórico disponible de tu plan, con fechas UTC y separador punto y coma. Los agregados horarios incluyen horas completas; el tramo final figura en comprobaciones y resumen. Los informes grandes se dividen en partes de hasta 50.000 filas: continúa hasta que aparezca «Exportación completada». No se incluyen credenciales ni secretos de integraciones.</p>
  {progress&&<p className="report-progress" role="status">{progress}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
 </div></section>;
}
