import {useEffect,useState} from 'react';
import {CalendarDays} from 'lucide-react';
import type {PlanLimits} from '../shared/plans';
import {availabilitySummary} from '../shared/availability';
import type {HourStat,Monitor} from './types';
import {request} from './api';
import {demoData} from './demo';
import {UptimeBars} from './ui';
import './workspace-improvements.css';
type Range={from:number;to:number;stats:HourStat[];last24:HourStat[];last24From:number;serverTime:number};
const inputTime=(time:number)=>{const d=new Date(time*1000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,13)+':00';};
function Band({title,stats,from,to,count=30}:{title:string;stats:HourStat[];from:number;to:number;count?:number}){
 const summary=availabilitySummary(stats);
 return <article className="availability-band"><header><h4>{title}</h4><strong>{summary.uptime===null?'Sin datos':summary.uptime.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' %'}</strong></header><UptimeBars stats={stats} from={from} to={to} count={count} interactive/><p>{summary.total.toLocaleString('es-ES')} comprobaciones · {summary.total-summary.successful} fallidas{summary.responseMs!==null?' · '+Math.round(summary.responseMs)+' ms de media':''}</p></article>;
}
export function MonitorAvailability({monitor,limits,demo}:{monitor:Monitor;limits:PlanLimits;demo:boolean}){
 const [base,setBase]=useState<Range|null>(null),[custom,setCustom]=useState<Range|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [dates,setDates]=useState({from:inputTime(Date.now()/1000-86400),to:inputTime(Date.now()/1000)}),days=Math.min(30,limits.historyDays);
 async function load(query:string){
  if(!demo)return request<Range>(`/monitors/${monitor.id}/availability?${query}`);
  const now=Math.floor(Date.now()/1000),hour=Math.floor(now/3600)*3600,q=new URLSearchParams(query),from=q.has('from')?Number(q.get('from')):hour-(Number(q.get('days'))*24-1)*3600,to=q.has('to')?Math.min(now,Number(q.get('to'))):now;
  const stats=demoData(Math.min(limits.historyDays,Math.max(30,days)),limits.id==='business'?'business':limits.id==='pro'?'pro':'free').stats.filter(s=>s.monitorId===monitor.id);
  return {from,to,stats:stats.filter(s=>s.hour>=from&&s.hour<to),last24:stats.filter(s=>s.hour>=hour-23*3600),last24From:hour-23*3600,serverTime:now};
 }
 useEffect(()=>{let active=true;setError('');load('days='+days).then(r=>{if(active)setBase(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[monitor.id,monitor.lastCheckedAt,days,demo]);
 const end=base?Math.floor(base.serverTime/3600)*3600+3600:0;
 return <section className="monitor-availability"><div className="availability-heading"><div><h3><CalendarDays size={17}/>Disponibilidad</h3><p>Tres periodos a la vista. Consulta los bloques para ver sus mediciones.</p></div><button className="button secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>Periodo personalizado</button></div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="availability-bands">{base?[1,7,30].map(n=>n<=limits.historyDays?<Band key={n} title={n===1?'Últimas 24 horas':`Últimos ${n} días`} stats={base.stats.filter(s=>s.hour>=end-n*86400)} from={end-n*86400} to={end} count={n===1?24:n===7?28:30}/>:<article key={n} className="availability-band unavailable"><header><h4>Últimos {n} días</h4><strong>No incluido</strong></header><p>Tu plan conserva {limits.historyDays} días. Este periodo necesita un plan con más histórico.</p></article>):!error&&<p role="status">Consultando disponibilidad…</p>}</div>
  {open&&<div className="availability-custom"><h4>Consulta personalizada</h4><form className="availability-range" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const from=Math.floor(new Date(dates.from).getTime()/3600000)*3600,to=Math.floor(new Date(dates.to).getTime()/3600000)*3600;setCustom(await load(`from=${from}&to=${to}`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>Desde<input type="datetime-local" step={3600} required min={inputTime(Date.now()/1000-(limits.historyDays*24-1)*3600)} max={dates.to} value={dates.from} onChange={e=>setDates({...dates,from:e.target.value})}/></label><label>Hasta<input type="datetime-local" step={3600} required min={dates.from} max={inputTime(Date.now()/1000)} value={dates.to} onChange={e=>setDates({...dates,to:e.target.value})}/></label><button className="button primary" disabled={busy}>{busy?'Consultando…':'Consultar periodo'}</button></form>{custom&&<Band title="Periodo personalizado" stats={custom.stats} from={custom.from} to={Math.ceil(custom.to/3600)*3600} count={Math.min(48,Math.max(2,Math.ceil((custom.to-custom.from)/3600)))}/>}</div>}
  <p className="availability-footnote">Resolución horaria · histórico: {limits.historyDays} días. Los bloques grises indican ausencia de mediciones, no disponibilidad. El periodo personalizado no sustituye las tres franjas.</p>
 </section>;
}
