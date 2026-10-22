import { useState } from 'react';
import { CalendarClock, ExternalLink, Pause, Play, RefreshCw, Signal, Trash2, Wrench } from 'lucide-react';
import type { PlanLimits } from '../shared/plans';
import type { MaintenanceWindow } from '../shared/maintenance';
import type { Check, Monitor } from './types';
import { request } from './api';
import { dateTime, Modal, relative, Status } from './ui';

export type HistoryResult='all'|'failed'|'ok';
export function MonitorDetail({monitor,history,busy,demo,onClose,onAction,onRenamed,limits,hasMore,loadingHistory,onLoadMore,historyFilter,onFilterChange,maintenance,onMaintenance}:{
  limits:PlanLimits;hasMore:boolean;loadingHistory:boolean;onLoadMore:()=>Promise<void>;monitor:Monitor;history:Check[];busy:boolean;demo:boolean;onClose:()=>void;
  onAction:(type:'pause'|'check'|'delete')=>Promise<void>;onRenamed:()=>Promise<void>;historyFilter:HistoryResult;onFilterChange:(filter:HistoryResult)=>void;maintenance?:MaintenanceWindow;onMaintenance:()=>void;
}) {
  const [confirmDelete,setConfirmDelete]=useState(false),[name,setName]=useState(monitor.name),[error,setError]=useState('');
  return <Modal title="Detalle del monitor" onClose={onClose} wide>
    <div className="detail-header"><span className="site-icon"><Signal size={23}/></span><div><h3>{monitor.name}</h3><a href={monitor.url} target="_blank" rel="noreferrer">{monitor.url}<ExternalLink size={13}/></a><small>Dominio: {monitor.rootDomain}</small></div><Status monitor={monitor} intervalSeconds={limits.intervalSeconds} maintenance={maintenance}/></div>
    <div className="detail-metrics"><div><span>Último HTTP</span><strong>{monitor.lastStatusCode??'—'}</strong></div><div><span>Tiempo</span><strong>{monitor.lastResponseMs===null?'—':`${monitor.lastResponseMs} ms`}</strong></div><div><span>Última revisión</span><strong>{relative(monitor.lastCheckedAt)}</strong></div></div>
    {maintenance&&<div className="maintenance-form-note"><Wrench size={18}/><p><strong>Mantenimiento hasta {dateTime(maintenance.endsAt)}.</strong> {maintenance.reason}. Las métricas muestran las últimas mediciones anteriores.</p></div>}
    {monitor.lastError&&!maintenance&&<p className="form-error">{monitor.lastError}</p>}
    <div className="detail-actions"><button disabled={busy||Boolean(maintenance)||monitor.paused} className="button secondary" onClick={()=>onAction('check')}><RefreshCw size={15}/>Comprobar ahora</button><button disabled={busy} className="button secondary" onClick={()=>onAction('pause')}>{monitor.paused?<Play size={15}/>:<Pause size={15}/>} {monitor.paused?'Reanudar':'Pausar'}</button><button className="button secondary" onClick={onMaintenance}><CalendarClock size={15}/>{maintenance?'Ver mantenimiento':'Programar mantenimiento'}</button></div>
    <form className="rename-form" onSubmit={async event=>{event.preventDefault();if(demo){setError('Los monitores de esta demo son ejemplos.');return;}try{await request(`/monitors/${monitor.id}`,'PATCH',{name});await onRenamed();setError('');}catch(e){setError((e as Error).message);}}}><label>Nombre<input value={name} onChange={event=>setName(event.target.value)} maxLength={60} required/></label><button className="button secondary">Guardar</button></form>{error&&<p className="form-error" role="alert">{error}</p>}
    <div className="history-heading"><h3 className="history-title">Comprobaciones recientes <span>Últimos {limits.historyDays} días · bloques de 100</span></h3><label>Resultados<select aria-label="Filtrar comprobaciones" value={historyFilter} onChange={event=>onFilterChange(event.target.value as HistoryResult)}><option value="all">Todos</option><option value="failed">Solo errores</option><option value="ok">Solo correctos</option></select></label></div>
    <div className="history-scroll" aria-busy={loadingHistory}>{!history.length?<p className="muted">{loadingHistory?'Consultando comprobaciones…':'No hay resultados para este filtro.'}</p>:<table className="history-table"><thead><tr><th>Fecha</th><th>HTTP</th><th>Tiempo</th><th>Resultado</th></tr></thead><tbody>{history.map((item,index)=><tr key={`${item.checkedAt}:${index}`}><td>{dateTime(item.checkedAt)}</td><td>{item.statusCode??'—'}</td><td>{Math.round(item.responseMs)} ms</td><td>{item.ok?<span className="good">Correcto</span>:<span className="bad">{item.error??'Error de comprobación'}</span>}</td></tr>)}</tbody></table>}</div>
    <p className="history-count" role="status">{history.length} {history.length===1?'resultado cargado':'resultados cargados'}{historyFilter==='failed'?' · solo errores':historyFilter==='ok'?' · solo correctos':''}.</p>{hasMore&&<button className="button secondary history-more" disabled={loadingHistory} onClick={onLoadMore}>{loadingHistory?'Cargando…':'Cargar resultados anteriores'}</button>}
    <div className="delete-area">{confirmDelete?<><p>Se eliminarán el monitor, su historial, sus mantenimientos y sus incidencias.</p><button className="button danger" disabled={busy} onClick={()=>onAction('delete')}>Confirmar eliminación</button><button className="text-button" onClick={()=>setConfirmDelete(false)}>Cancelar</button></>:<button className="text-button danger-text" onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/>Eliminar monitor</button>}</div>
  </Modal>;
}
