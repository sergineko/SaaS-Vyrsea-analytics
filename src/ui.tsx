import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { HourStat, Monitor } from './types';
import { FREE_LIMITS, staleAfterSeconds } from '../shared/plans';
import type { MaintenanceWindow } from '../shared/maintenance';
import { availabilityBuckets } from '../shared/availability';
export const dateTime = (time: number) => new Date(time * 1000).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const relative = (time: number | null) => {
  if (!time) return 'Sin comprobar';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - time);
  return seconds < 60 ? `Hace ${seconds} s` : seconds < 3600 ? `Hace ${Math.floor(seconds / 60)} min` : `Hace ${Math.floor(seconds / 3600)} h`;
};
export function Status({ monitor, intervalSeconds = FREE_LIMITS.intervalSeconds, maintenance }: { monitor: Monitor; intervalSeconds?: number; maintenance?: MaintenanceWindow }) {
  const stale = !monitor.paused && monitor.lastCheckedAt !== null && Date.now() / 1000 - monitor.lastCheckedAt > staleAfterSeconds(intervalSeconds);
  const status = monitor.paused ? 'paused' : maintenance ? 'maintenance' : stale ? 'pending' : monitor.status;
  const label = monitor.paused ? 'En pausa' : maintenance ? 'Mantenimiento' : stale ? 'Sin datos recientes' : ({ up: 'Operativo', down: 'Caído', degraded: 'Confirmando', pending: 'Pendiente' } as const)[monitor.status];
  return <span className={`status status-${status}`}><i />{label}</span>;
}
export function UptimeBars({ stats, count = 24, days = 1, from, to, interactive=false }: { stats: HourStat[]; count?: number; days?: number;from?:number;to?:number;interactive?:boolean }) {
  const end=to??Math.floor(Date.now()/3600000)*3600+3600,start=from??end-count*days*3600;
  const [focus,setFocus]=useState<number|null>(null),buckets=availabilityBuckets(stats,start,end,count);
  const label=(b:typeof buckets[number])=>`${dateTime(b.from)} · ${b.total?`${(100*b.successful/b.total).toLocaleString('es-ES',{maximumFractionDigits:2})} % · ${b.successful}/${b.total} correctas`:'Sin mediciones'}`;
  return <div className={interactive?'availability-timeline':''}><div className="uptime-bars" aria-label={(end-start)/count===3600?'Disponibilidad por hora':'Disponibilidad por intervalos del periodo'}>{buckets.map((b,i)=>{
    const className=!b.total?'no-data':b.successful===b.total?'healthy':b.successful?'partial':'failed';
    return interactive?<button key={i} className={className} aria-label={label(b)} title={label(b)} onFocus={()=>setFocus(i)} onBlur={()=>setFocus(null)} onPointerEnter={()=>setFocus(i)} onPointerLeave={()=>setFocus(null)}/>:<span key={i} className={className} title={label(b)}/>;
  })}</div>{interactive&&<div className="timeline-caption"><span>{focus===null?dateTime(start):label(buckets[focus])}</span><span>{focus===null?dateTime(end):'Intervalos horarios · sin muestras ≠ caída'}</span></div>}</div>;
}
export function Chart({ stats, days = 1 }: { stats: HourStat[]; days?: number }) {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const values=availabilityBuckets(stats,now+3600-24*days*3600,now+3600,24).map(bucket=>bucket.total?Math.round(bucket.totalMs/bucket.total):null);
  const max = Math.max(400, ...values.filter((v): v is number => v !== null)) * 1.2;
  const paths: string[] = []; let path = '';
  values.forEach((value, i) => { if (value === null) { if (path) paths.push(path); path = ''; } else path += `${path ? ' L' : 'M'}${46 + i * 654 / 23},${154 - value / max * 120}`; }); if (path) paths.push(path);
  return <svg className="response-chart" viewBox="0 0 735 190" role="img" aria-label={`Tiempo medio de respuesta HTTP por intervalos de ${days} ${days === 1 ? 'hora' : 'horas'}, en milisegundos`}>
    {[0, 1, 2, 3].map(i => <g key={i}><line x1="46" x2="710" y1={34+i*40} y2={34+i*40} stroke="currentColor" strokeDasharray="3 5" /><text x="2" y={38+i*40}>{Math.round(max*(1-i/3))}</text></g>)}
    {paths.map((p, i) => <path key={i} d={p} fill="none" stroke="#315feb" strokeWidth="2.5" strokeLinejoin="round" />)}
    {[0,6,12,18,23].map(i => <text key={i} x={46+i*654/23} y="183" textAnchor="middle">{days === 1 ? new Date((now-(23-i)*3600)*1000).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}) : new Date((now + 3600 - (24-i)*days*3600)*1000).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}</text>)}
    {!stats.length && <text className="chart-empty" x="375" y="100" textAnchor="middle">Esperando las primeras comprobaciones</text>}
  </svg>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]') ?? []);
    items()[0]?.focus(); const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); if (e.key !== 'Tab') return; const all=items(); const first=all[0],last=all[all.length-1]; if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();} };
    document.addEventListener('keydown',handler);
    return () => { document.body.style.overflow=previousOverflow; document.removeEventListener('keydown',handler); previous?.focus(); };
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className={`modal ${wide?'wide':''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={20}/></button></div>{children}</div></div>;
}
